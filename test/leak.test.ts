// README "Logging": a test fails if any log line contains a query string, a 22-character
// id, or a secret used in the test. This drives every route (happy and failing paths) and
// the sweep, then checks every line written.

import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { randomBase64Url, sha256Base64Url, toBase64Url, utf8 } from '../src/encoding';
import { getKeys, makeEnrollment } from '../src/keys';
import { ROUTES } from '../src/log';
import {
  call,
  captureLogs,
  CODE,
  fakeInstagram,
  fragmentParams,
  graphError,
  json,
  LONG_TOKEN,
  SHORT_TOKEN,
  USER_ID,
} from './helpers';
import { makeJpeg } from './jpegs';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const Batch = v.strictObject({
  id: v.string(),
  frames: v.array(v.strictObject({ put: v.string(), url: v.string() })),
  delete: v.string(),
});

function path(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

async function metaSignedRequest(): Promise<string> {
  const encoded = toBase64Url(
    utf8(
      JSON.stringify({
        algorithm: 'HMAC-SHA256',
        issued_at: Math.floor(Date.now() / 1000),
        user_id: USER_ID,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(env.IG_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return `${toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(encoded))))}.${encoded}`;
}

it('no log line carries a query string, an id, or a secret, on any route', async () => {
  const logs = captureLogs();
  // Instagram's error message (which echoes the token) must not be logged either.
  let meReply: () => Response = () =>
    json({ user_id: USER_ID, username: 'secretusername', account_type: 'BUSINESS' });
  fakeInstagram({ me: () => meReply() });
  const secrets: string[] = [
    CODE,
    SHORT_TOKEN,
    LONG_TOKEN,
    USER_ID,
    'secretusername',
    env.IG_APP_SECRET,
    env.SERVER_SECRET,
  ];

  // --- Sign-in ---
  const verifier = randomBase64Url(32);
  const state = `dev.${randomBase64Url(32)}.${await sha256Base64Url(verifier)}`;
  secrets.push(verifier, state);
  const signIn = await call(
    `/auth/callback?${new URLSearchParams({ code: CODE, state }).toString()}`,
  );
  expect(signIn.status).toBe(303);
  const sealed = fragmentParams(signIn.headers.get('Location')).get('instagram') ?? '';
  secrets.push(sealed);
  // Failing callbacks: cancelled, unknown client, bad state.
  await call(`/auth/callback?${new URLSearchParams({ error: 'access_denied', state }).toString()}`);
  await call(
    `/auth/callback?code=${CODE}&state=evil.${randomBase64Url(32)}.${randomBase64Url(32)}`,
  );
  await call(`/auth/callback?code=${CODE}&state=${encodeURIComponent('x?y=z')}`);

  const redeemed = await call('/auth/redeem', {
    method: 'POST',
    headers: { Origin: 'http://localhost:5175' },
    body: JSON.stringify({ sealed, verifier }),
  });
  expect(redeemed.status).toBe(200);
  const connection = v.parse(v.object({ enrollment: v.string() }), await redeemed.json());
  secrets.push(connection.enrollment);
  await call('/auth/redeem', {
    method: 'POST',
    body: JSON.stringify({ sealed, verifier: randomBase64Url(32) }),
  });
  await call('/auth/redeem', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5175' } });
  for (const p of ['/auth/renew', '/uploads', `/uploads/${randomBase64Url(16)}`]) {
    await call(p, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5175' } });
  }

  meReply = () => json({ user_id: USER_ID });
  const renewal = await call('/auth/renew', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LONG_TOKEN}` },
    body: JSON.stringify({ enrollment: connection.enrollment }),
  });
  expect(renewal.status).toBe(200);
  secrets.push(v.parse(v.object({ enrollment: v.string() }), await renewal.json()).enrollment);

  // --- Frames ---
  const enrollment = await makeEnrollment(
    await getKeys(env.SERVER_SECRET),
    USER_ID,
    Math.floor(Date.now() / 1000),
  );
  secrets.push(enrollment);
  const started = await call('/uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LONG_TOKEN}` },
    body: JSON.stringify({ enrollment, count: 2 }),
  });
  expect(started.status).toBe(200);
  const batch = v.parse(Batch, await started.json());
  const [frame0, frame1] = batch.frames;
  if (!frame0 || !frame1) throw new Error('no frames');
  const ids = [batch.id];
  for (const url of [frame0.put, frame1.put, batch.delete]) {
    const sig = new URL(url).searchParams.get('sig');
    if (sig !== null) secrets.push(sig);
  }

  expect((await call(path(frame0.put), { method: 'PUT', body: makeJpeg() })).status).toBe(204);
  expect((await call(path(frame0.put), { method: 'PUT', body: makeJpeg() })).status).toBe(409);
  expect(
    (await call(path(frame1.put), { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status,
  ).toBe(415);
  await call(`/uploads/${batch.id}/1.jpg?exp=1&sig=${randomBase64Url(32)}`, {
    method: 'PUT',
    body: 'x',
  });
  await call(path(frame0.put), { method: 'OPTIONS', headers: { Origin: 'http://localhost:5175' } });
  expect((await call(path(frame0.url))).status).toBe(200);
  expect((await call(path(frame0.url), { method: 'HEAD' })).status).toBe(200);
  expect((await call(path(frame1.url))).status).toBe(404);

  // Instagram failing, with a message echoing the token.
  meReply = () => graphError(400);
  expect(
    (
      await call('/uploads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${LONG_TOKEN}` },
        body: JSON.stringify({ enrollment, count: 1 }),
      })
    ).status,
  ).toBe(401);

  expect((await call(path(batch.delete), { method: 'DELETE' })).status).toBe(204);

  // --- Meta ---
  const signedRequest = await metaSignedRequest();
  secrets.push(signedRequest);
  const form = new URLSearchParams({ signed_request: signedRequest }).toString();
  expect((await call('/meta/deauthorize', { method: 'POST', body: form })).status).toBe(200);
  const deletion = await call('/meta/data-deletion', { method: 'POST', body: form });
  const { confirmation_code } = v.parse(
    v.object({ confirmation_code: v.string() }),
    await deletion.json(),
  );
  secrets.push(confirmation_code);
  expect((await call(`/meta/deletion?code=${confirmation_code}`)).status).toBe(200);

  // --- Unmatched and malformed ---
  const strayId = randomBase64Url(16);
  ids.push(strayId);
  await call(`/nowhere/${strayId}?token=${LONG_TOKEN}`);
  await call(`/frames/${strayId}/0.jpg?x=${LONG_TOKEN}`);

  // --- Sweep ---
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  // --- The checks ---
  const lines = logs.lines();
  expect(lines.length).toBeGreaterThan(25);
  for (const line of lines) {
    expect(line).not.toMatch(/\?/);
    expect(line).not.toMatch(/[A-Za-z0-9_-]{22,}/);
    for (const id of ids) expect(line).not.toContain(id);
    for (const secret of secrets) expect(line).not.toContain(secret);
    expect(line).not.toContain('Invalid OAuth');
    expect(line).not.toContain('localhost');
    expect(line).not.toContain('server.test');
  }

  // Every request line names a known route template, and batch routes carry the hash.
  const requestLines = logs
    .records()
    .map((r) =>
      v.safeParse(
        v.looseObject({ event: v.literal('request'), route: v.string(), status: v.number() }),
        r,
      ),
    )
    .filter((r) => r.success)
    .map((r) => r.output);
  const seen = new Set(requestLines.map((r) => r.route));
  for (const route of ROUTES) expect(seen).toContain(route);
  for (const line of requestLines) {
    // Batch routes (not preflights) carry the batch hash.
    if (line.route.includes(':id') && !line.route.startsWith('OPTIONS')) {
      expect(
        v.is(v.looseObject({ batch: v.pipe(v.string(), v.regex(/^[0-9a-f]{8}$/)) }), line),
      ).toBe(true);
    }
  }
  expect(logs.records()).toContainEqual(expect.objectContaining({ event: 'sweep' }));
  expect(logs.records()).toContainEqual(
    expect.objectContaining({ event: 'instagram', status: 400 }),
  );
});
