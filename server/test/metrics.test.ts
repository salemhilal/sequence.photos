import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { randomBase64Url, sha256Base64Url } from '../src/encoding';
import { getKeys, seal } from '../src/keys';
import { Tag } from '../src/log';
import { parsePostResult, record, toDataPoint } from '../src/metrics';
import {
  Batch,
  call,
  fakeInstagram,
  json,
  LONG_TOKEN,
  newEnrollment,
  nowSeconds,
  path,
  postJson,
  USER_ID,
} from './helpers';
import { makeJpeg } from './jpegs';

/** Captures the data points the Worker writes from now on. */
function captureMetrics(): () => AnalyticsEngineDataPoint[] {
  const spy = vi.spyOn(env.METRICS, 'writeDataPoint').mockImplementation(() => undefined);
  return () => spy.mock.calls.map(([point]) => point ?? {});
}

async function userTag(): Promise<string> {
  return (await Tag.user((await getKeys(env.SERVER_SECRET)).log, USER_ID)).hex;
}

describe('data points', () => {
  it('have fixed columns, with blanks for what an event lacks', async () => {
    const batch = await Tag.batch('AAAAAAAAAAAAAAAAAAAAAA');
    expect(toDataPoint({ event: 'frame', batch, bytes: 1234 })).toEqual({
      indexes: ['frame'],
      blobs: ['frame', '', batch.hex, ''],
      doubles: [0, 1234],
    });
    expect(toDataPoint({ event: 'post', batch, result: 'posted', frames: 3 })).toEqual({
      indexes: ['post'],
      blobs: ['post', '', batch.hex, 'posted'],
      doubles: [3, 0],
    });
  });

  it('read the post result strictly', () => {
    expect(parsePostResult('posted')).toBe('posted');
    expect(parsePostResult('cancelled')).toBe('cancelled');
    expect(parsePostResult(null)).toBe('unreported');
    expect(parsePostResult('POSTED')).toBe('unreported');
    expect(parsePostResult('x'.repeat(100))).toBe('unreported');
  });

  it('never throw', async () => {
    const failing = {
      writeDataPoint: () => {
        throw new Error('down');
      },
    };
    const batch = await Tag.batch('AAAAAAAAAAAAAAAAAAAAAA');
    expect(() => {
      record(failing, { event: 'frame', batch, bytes: 1 });
    }).not.toThrow();
  });
});

describe('what the Worker counts', () => {
  it('a batch, its frames, and the post result, without ids', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const metrics = captureMetrics();
    const started = await postJson('/uploads', { enrollment: await newEnrollment(), count: 2 });
    instagram.restore();
    const batch = v.parse(Batch, await started.json());
    for (const frame of batch.frames) {
      const put = await call(path(frame.put), { method: 'PUT', body: makeJpeg() });
      expect(put.status).toBe(204);
    }
    const deleted = await call(`${path(batch.delete)}&result=posted`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);

    const user = await userTag();
    const tag = (await Tag.batch(batch.id)).hex;
    const points = metrics();
    expect(points.map((p) => p.blobs)).toEqual([
      ['batch', user, tag, ''],
      ['frame', '', tag, ''],
      ['frame', '', tag, ''],
      ['post', '', tag, 'posted'],
    ]);
    expect(points[0]?.doubles).toEqual([2, 0]);
    expect(points[3]?.doubles).toEqual([2, 0]);
    const text = JSON.stringify(points);
    for (const secret of [USER_ID, batch.id, LONG_TOKEN]) expect(text).not.toContain(secret);
  });

  it('a delete without a result as unreported, and nothing for a refused one', async () => {
    const instagram = fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    const started = await postJson('/uploads', { enrollment: await newEnrollment(), count: 1 });
    instagram.restore();
    const batch = v.parse(Batch, await started.json());
    const metrics = captureMetrics();
    const forged = batch.delete.replace(/sig=[^&]+/, 'sig=AAAA');
    expect((await call(`${path(forged)}&result=posted`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(path(batch.delete), { method: 'DELETE' })).status).toBe(204);
    expect(metrics().map((p) => p.blobs?.[3])).toEqual(['unreported']);
  });

  it('sign-ins and renewals, by user', async () => {
    const metrics = captureMetrics();
    const verifier = randomBase64Url(32);
    const now = nowSeconds();
    const sealed = await seal(
      await getKeys(env.SERVER_SECRET),
      {
        connection: {
          token: LONG_TOKEN,
          expiresAt: now + 86400,
          refreshedAt: now,
          userId: USER_ID,
          username: 'someone',
          enrollment: await newEnrollment(now),
        },
        challenge: await sha256Base64Url(verifier),
      },
      now,
    );
    expect((await postJson('/auth/redeem', { sealed, verifier }, null)).status).toBe(200);
    fakeInstagram({ me: () => json({ user_id: USER_ID }) });
    expect((await postJson('/auth/renew', { enrollment: await newEnrollment() })).status).toBe(200);

    const user = await userTag();
    expect(metrics().map((p) => p.blobs)).toEqual([
      ['connect', user, '', ''],
      ['renew', user, '', ''],
    ]);
  });
});
