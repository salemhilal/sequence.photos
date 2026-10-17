import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKeys, LIFETIME, sign } from '../src/keys';
import { FRAME_MAX_AGE } from '../src/storage';
import {
  Batch,
  call,
  captureLogs,
  fakeInstagram,
  graphError,
  json,
  LONG_TOKEN,
  newEnrollment,
  nowSeconds,
  path,
  postJson,
  requestRecord,
  USER_ID,
} from './helpers';
import { concat, makeJpeg, PNG } from './jpegs';

afterEach(() => {
  vi.useRealTimers();
});

function postUploads(body: unknown, token: string | null = LONG_TOKEN): Promise<Response> {
  return postJson('/uploads', body, token);
}

async function startBatch(count: number): Promise<Batch> {
  const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
  const response = await postUploads({ enrollment: await newEnrollment(), count });
  instagram.restore();
  expect(response.status).toBe(200);
  return v.parse(Batch, await response.json());
}

function put(url: string, body: BodyInit): Promise<Response> {
  return call(path(url), { method: 'PUT', body });
}

function frameUrl(batch: Batch, i: number): string {
  const frame = batch.frames[i];
  if (!frame) throw new Error(`no frame ${i}`);
  return frame.url;
}

function putUrl(batch: Batch, i: number): string {
  const frame = batch.frames[i];
  if (!frame) throw new Error(`no frame ${i}`);
  return frame.put;
}

describe('POST /uploads', () => {
  it('starts a batch: signed PUT URLs, public frame URLs, a signed DELETE', async () => {
    const { requests } = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const logs = captureLogs();
    const now = nowSeconds();
    const response = await postUploads({ enrollment: await newEnrollment(), count: 3 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const batch = v.parse(Batch, await response.json());

    expect(batch.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(batch.frames).toHaveLength(3);
    batch.frames.forEach((frame, i) => {
      expect(frame.url).toBe(`https://server.test/frames/${batch.id}/${i}.jpg`);
      const putUrl = new URL(frame.put);
      expect(putUrl.origin + putUrl.pathname).toBe(
        `https://server.test/uploads/${batch.id}/${i}.jpg`,
      );
      const exp = Number(putUrl.searchParams.get('exp'));
      expect(exp - now).toBeGreaterThanOrEqual(LIFETIME.PUT);
      expect(exp - now).toBeLessThanOrEqual(LIFETIME.PUT + 2);
      expect(putUrl.searchParams.get('sig')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
    const deleteUrl = new URL(batch.delete);
    expect(deleteUrl.pathname).toBe(`/uploads/${batch.id}`);
    expect(Number(deleteUrl.searchParams.get('exp')) - now).toBeGreaterThanOrEqual(LIFETIME.DELETE);

    // /me was asked for the user id, with the bearer token.
    const meUrl = new URL(requests[0]?.url ?? '');
    expect(meUrl.searchParams.get('fields')).toBe('user_id');
    expect(meUrl.searchParams.get('access_token')).toBe(LONG_TOKEN);

    // Logged with user and batch tags, never the id or token.
    const record = logs.records()[0];
    expect(record).toMatchObject({ route: 'POST /uploads', status: 200, outcome: 'ok' });
    const tags = v.parse(v.object({ user: v.string(), batch: v.string() }), record);
    expect(tags.user).toMatch(/^[0-9a-f]{8}$/);
    expect(tags.batch).toMatch(/^[0-9a-f]{8}$/);
    for (const line of logs.lines()) {
      expect(line).not.toContain(batch.id);
      expect(line).not.toContain(LONG_TOKEN);
    }
  });

  it('allows 1 to MAX_FRAMES frames', async () => {
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const good = await newEnrollment();
    expect((await postUploads({ enrollment: good, count: 1 })).status).toBe(200);
    expect((await postUploads({ enrollment: good, count: 10 })).status).toBe(200);
    for (const count of [0, 11, -1, 1.5, '3', null]) {
      expect((await postUploads({ enrollment: good, count })).status).toBe(400);
    }
    expect((await postUploads({ enrollment: good })).status).toBe(400);
  });

  it('checks the enrollment before calling Instagram', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const expired = await newEnrollment(nowSeconds() - LIFETIME.ENROLL - 1);
    expect((await postUploads({ enrollment: expired, count: 1 })).status).toBe(401);
    expect((await postUploads({ enrollment: 'forged.value', count: 1 })).status).toBe(401);
    expect(instagram.requests).toHaveLength(0);
  });

  it('requires a bearer token', async () => {
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    expect((await postUploads({ enrollment: await newEnrollment(), count: 1 }, null)).status).toBe(
      401,
    );
  });

  it("refuses a token for someone else (any app's token passes /me)", async () => {
    fakeInstagram({ me: () => json({ user_id: '17841499999999999' }) });
    const logs = captureLogs();
    expect((await postUploads({ enrollment: await newEnrollment(), count: 1 })).status).toBe(401);
    expect(logs.records()).toContainEqual(
      expect.objectContaining({ event: 'request', outcome: 'enrollment_mismatch' }),
    );
  });

  it('401s when Instagram rejects the token, 502s when it is down', async () => {
    const instagram = fakeInstagram({ me: () => graphError(400) });
    expect((await postUploads({ enrollment: await newEnrollment(), count: 1 })).status).toBe(401);
    instagram.set({ me: () => new Response('', { status: 500 }) });
    const logs = captureLogs();
    expect((await postUploads({ enrollment: await newEnrollment(), count: 1 })).status).toBe(502);
    expect(requestRecord(logs.records())).toMatchObject({ outcome: 'instagram_unavailable' });
  });

  it('413s a body over 4 KB', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const enrollment = await newEnrollment();
    const response = await postUploads({ enrollment, count: 1, pad: 'x'.repeat(4096) });
    expect(response.status).toBe(413);
    expect(instagram.requests).toHaveLength(0);
  });
});

describe('PUT /uploads/:id/:i.jpg', () => {
  it('stores a frame once, as image/jpeg with no custom metadata', async () => {
    const batch = await startBatch(2);
    const logs = captureLogs();
    const jpeg = makeJpeg({ width: 1080, height: 1440 });
    const response = await put(putUrl(batch, 1), jpeg);
    expect(response.status).toBe(204);

    const object = await env.FRAMES.get(`frames/${batch.id}/1.jpg`);
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(jpeg);
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(object?.customMetadata).toEqual({});

    const record = logs.records()[0];
    expect(record).toMatchObject({
      method: 'PUT',
      route: 'PUT /uploads/:id/:i.jpg',
      status: 204,
      i: 1,
      bytes: jpeg.length,
      width: 1080,
      height: 1440,
      query: ['exp', 'sig'],
    });
    expect(v.parse(v.object({ batch: v.string() }), record).batch).toMatch(/^[0-9a-f]{8}$/);
  });

  it('409s a second PUT to the same frame and keeps the first image', async () => {
    const batch = await startBatch(1);
    const first = makeJpeg({ width: 1080 });
    const second = makeJpeg({ width: 1000 });
    expect((await put(putUrl(batch, 0), first)).status).toBe(204);
    const logs = captureLogs();
    expect((await put(putUrl(batch, 0), second)).status).toBe(409);
    expect(logs.records()[0]).toMatchObject({ outcome: 'exists' });
    const stored = await env.FRAMES.get(`frames/${batch.id}/0.jpg`);
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(first);
  });

  it('refuses expired, missing, tampered, and mismatched signatures', async () => {
    const batch = await startBatch(2);
    const jpeg = makeJpeg();
    const url = new URL(putUrl(batch, 0));
    const at = (p: string, params: Record<string, string>) =>
      put(`https://server.test${p}?${new URLSearchParams(params).toString()}`, jpeg);
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';

    // Frame 0's signature on frame 1's path.
    expect((await at(`/uploads/${batch.id}/1.jpg`, { exp, sig })).status).toBe(403);
    // Another batch.
    expect((await at(`/uploads/${'B'.repeat(22)}/0.jpg`, { exp, sig })).status).toBe(403);
    // A different exp.
    expect((await at(url.pathname, { exp: String(Number(exp) + 1), sig })).status).toBe(403);
    // Tampered, missing.
    const tampered = (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect((await at(url.pathname, { exp, sig: tampered })).status).toBe(403);
    expect((await at(url.pathname, { exp })).status).toBe(403);
    expect((await at(url.pathname, { sig })).status).toBe(403);
    expect((await at(url.pathname, {})).status).toBe(403);
    // A DELETE signature isn't a PUT signature.
    const del = new URL(batch.delete);
    expect(
      (
        await at(url.pathname, {
          exp: del.searchParams.get('exp') ?? '',
          sig: del.searchParams.get('sig') ?? '',
        })
      ).status,
    ).toBe(403);

    // Correctly signed but expired.
    const logs = captureLogs();
    const past = nowSeconds() - 1;
    const pastSig = await sign(await getKeys(env.SERVER_SECRET), {
      kind: 'PUT',
      id: batch.id,
      index: 0,
      exp: past,
    });
    expect((await at(url.pathname, { exp: String(past), sig: pastSig })).status).toBe(403);
    expect(logs.records()[0]).toMatchObject({ outcome: 'expired' });

    // Nothing was stored.
    expect((await env.FRAMES.list({ prefix: `frames/${batch.id}/` })).objects).toHaveLength(0);
  });

  it('expires 30 minutes after the batch starts', async () => {
    const batch = await startBatch(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (LIFETIME.PUT + 1) * 1000);
    expect((await put(putUrl(batch, 0), makeJpeg())).status).toBe(403);
  });

  it('refuses malformed ids and indexes', async () => {
    const batch = await startBatch(1);
    const { search } = new URL(putUrl(batch, 0));
    for (const p of [
      `/uploads/${batch.id}/01.jpg`,
      `/uploads/${batch.id}/10.jpg`,
      `/uploads/${batch.id}/-1.jpg`,
      `/uploads/${batch.id.slice(1)}/0.jpg`,
      `/uploads/${batch.id}x/0.jpg`,
      `/uploads/${batch.id.slice(0, 21)}%2F/0.jpg`,
    ]) {
      expect((await call(`${p}${search}`, { method: 'PUT', body: makeJpeg() })).status).toBe(400);
    }
  });

  it('refuses a frame over 8 MB before storing anything', async () => {
    const batch = await startBatch(1);
    const big = concat(makeJpeg(), new Uint8Array(8 * 1024 * 1024));
    const logs = captureLogs();
    expect((await put(putUrl(batch, 0), big)).status).toBe(413);
    expect(logs.records()[0]).toMatchObject({ outcome: 'too_large', bytes: big.length });
    expect(await env.FRAMES.head(`frames/${batch.id}/0.jpg`)).toBeNull();
  });

  it('requires Content-Length', async () => {
    const batch = await startBatch(1);
    const jpeg = makeJpeg();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(jpeg);
        controller.close();
      },
    });
    expect((await put(putUrl(batch, 0), stream)).status).toBe(411);
  });

  it('refuses anything but a plausible JPEG frame (415)', async () => {
    const jpeg = makeJpeg();
    for (const body of [
      PNG,
      concat(jpeg, new TextEncoder().encode('<html><script>alert(1)</script></html>')),
      jpeg.slice(0, 100),
      jpeg.slice(0, jpeg.length - 1),
      makeJpeg({ width: 1441 }),
      makeJpeg({ width: 319 }),
      makeJpeg({ height: 2561 }),
      makeJpeg({ sof: 0xc3 }),
      new Uint8Array(0),
    ]) {
      const batch = await startBatch(1);
      const logs = captureLogs();
      expect((await put(putUrl(batch, 0), body)).status).toBe(415);
      expect(logs.records()[0]).toMatchObject({ outcome: 'not_jpeg' });
      expect(await env.FRAMES.head(`frames/${batch.id}/0.jpg`)).toBeNull();
    }
  });
});

describe('GET /frames/:id/:i.jpg', () => {
  const expectedHeaders = {
    'content-type': 'image/jpeg',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': 'inline',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  };

  it('serves an uploaded frame with locked-down headers and no CORS', async () => {
    const batch = await startBatch(1);
    const jpeg = makeJpeg();
    await put(putUrl(batch, 0), jpeg);
    const logs = captureLogs();
    const response = await call(path(frameUrl(batch, 0)), {
      headers: { Origin: 'https://sequence.photos' },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
    expect(Object.fromEntries(response.headers)).toMatchObject(expectedHeaders);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const record = logs.records()[0];
    expect(record).toMatchObject({ method: 'GET', route: 'GET /frames/:id/:i.jpg', i: 0 });
    expect(v.parse(v.object({ batch: v.string() }), record).batch).toMatch(/^[0-9a-f]{8}$/);
  });

  it('answers HEAD with the same headers and no body', async () => {
    const batch = await startBatch(1);
    const jpeg = makeJpeg();
    await put(putUrl(batch, 0), jpeg);
    const logs = captureLogs();
    const response = await call(path(frameUrl(batch, 0)), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject(expectedHeaders);
    expect(response.headers.get('Content-Length')).toBe(String(jpeg.length));
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(logs.records()[0]).toMatchObject({ method: 'HEAD', route: 'HEAD /frames/:id/:i.jpg' });
  });

  it('404s missing frames and malformed paths', async () => {
    const batch = await startBatch(2);
    await put(putUrl(batch, 0), makeJpeg());
    for (const p of [
      `/frames/${batch.id}/1.jpg`,
      `/frames/${'C'.repeat(22)}/0.jpg`,
      `/frames/${batch.id}/01.jpg`,
      `/frames/${batch.id}/10.jpg`,
      `/frames/${batch.id.slice(1)}/0.jpg`,
    ]) {
      expect((await call(p)).status).toBe(404);
      expect((await call(p, { method: 'HEAD' })).status).toBe(404);
    }
  });

  it('404s a frame over an hour old, before the sweep runs', async () => {
    const batch = await startBatch(1);
    await put(putUrl(batch, 0), makeJpeg());
    expect((await call(path(frameUrl(batch, 0)))).status).toBe(200);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (FRAME_MAX_AGE - 60) * 1000);
    expect((await call(path(frameUrl(batch, 0)))).status).toBe(200);
    vi.setSystemTime(Date.now() + 120 * 1000);
    const logs = captureLogs();
    expect((await call(path(frameUrl(batch, 0)))).status).toBe(404);
    expect((await call(path(frameUrl(batch, 0)), { method: 'HEAD' })).status).toBe(404);
    expect(logs.records()[0]).toMatchObject({ outcome: 'expired' });
    // Still in R2 until the sweep.
    expect(await env.FRAMES.head(`frames/${batch.id}/0.jpg`)).not.toBeNull();
  });
});

describe('DELETE /uploads/:id', () => {
  it('upload → GET → DELETE: deletes the batch, and only that batch', async () => {
    const batch = await startBatch(3);
    const other = await startBatch(1);
    for (const i of [0, 1, 2]) expect((await put(putUrl(batch, i), makeJpeg())).status).toBe(204);
    expect((await put(putUrl(other, 0), makeJpeg())).status).toBe(204);
    for (const i of [0, 1, 2]) expect((await call(path(frameUrl(batch, i)))).status).toBe(200);

    const logs = captureLogs();
    expect((await call(path(batch.delete), { method: 'DELETE' })).status).toBe(204);
    expect(logs.records()[0]).toMatchObject({ route: 'DELETE /uploads/:id', status: 204 });
    for (const i of [0, 1, 2]) expect((await call(path(frameUrl(batch, i)))).status).toBe(404);
    expect((await env.FRAMES.list({ prefix: `frames/${batch.id}/` })).objects).toHaveLength(0);
    // The other batch is untouched.
    expect((await call(path(frameUrl(other, 0)))).status).toBe(200);
    // Already gone: still 204.
    expect((await call(path(batch.delete), { method: 'DELETE' })).status).toBe(204);
  });

  it('refuses bad, mismatched, and expired signatures, and malformed ids', async () => {
    const batch = await startBatch(1);
    await put(putUrl(batch, 0), makeJpeg());
    const url = new URL(batch.delete);
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    const del = (p: string, params: Record<string, string>) =>
      call(`${p}?${new URLSearchParams(params).toString()}`, { method: 'DELETE' });

    expect((await del(url.pathname, { exp, sig: sig.slice(1) + 'A' })).status).toBe(403);
    expect((await del(url.pathname, { exp })).status).toBe(403);
    expect((await del(`/uploads/${'D'.repeat(22)}`, { exp, sig })).status).toBe(403);
    // A PUT signature isn't a DELETE signature.
    const putParams = new URL(putUrl(batch, 0)).searchParams;
    expect(
      (
        await del(url.pathname, {
          exp: putParams.get('exp') ?? '',
          sig: putParams.get('sig') ?? '',
        })
      ).status,
    ).toBe(403);
    expect((await del(`/uploads/${batch.id}x`, { exp, sig })).status).toBe(400);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (LIFETIME.DELETE + 1) * 1000);
    expect((await del(url.pathname, { exp, sig })).status).toBe(403);
    vi.useRealTimers();

    expect(await env.FRAMES.head(`frames/${batch.id}/0.jpg`)).not.toBeNull();
  });
});
