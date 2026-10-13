import {
  createExecutionContext,
  createScheduledController,
  reset,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { FRAME_MAX_AGE } from '../src/storage';
import { sweep } from '../src/sweep';
import { captureLogs } from './helpers';

beforeEach(async () => {
  await reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const HOUR_AND_A_BIT = (FRAME_MAX_AGE + 60) * 1000;

async function putFrames(keys: string[]): Promise<void> {
  // In chunks, to keep the local R2 simulator happy.
  for (let i = 0; i < keys.length; i += 100) {
    await Promise.all(keys.slice(i, i + 100).map((key) => env.FRAMES.put(key, 'x')));
  }
}

function frameKeys(count: number, batch = 'AAAAAAAAAAAAAAAAAAAAAA'): string[] {
  return Array.from(
    { length: count },
    (_, i) => `frames/${batch}${String(i).padStart(4, '0')}/0.jpg`,
  );
}

async function remaining(prefix = ''): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.FRAMES.list({ prefix, ...(cursor ? { cursor } : {}) });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

describe('sweep', () => {
  it('deletes only frames over an hour old, page by page', async () => {
    const old = frameKeys(5, 'OLD');
    await putFrames(old);
    const newestOld = Math.max(
      ...(await Promise.all(
        old.map(async (k) => (await env.FRAMES.head(k))?.uploaded.getTime() ?? 0),
      )),
    );
    // Make sure the next uploads get a later timestamp.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fresh = frameKeys(3, 'NEW');
    await putFrames(fresh);
    await env.FRAMES.put('elsewhere/0.jpg', 'x');

    // Just past an hour after the old frames, but not the fresh ones.
    const now = newestOld + FRAME_MAX_AGE * 1000 + 1;
    const result = await sweep(env.FRAMES, now, 2);
    expect(result).toEqual({ listed: 8, deleted: 5, pages: 4 });
    expect((await remaining()).sort()).toEqual([...fresh, 'elsewhere/0.jpg'].sort());
  });

  it('keeps everything under an hour old', async () => {
    await putFrames(frameKeys(3));
    expect(await sweep(env.FRAMES, Date.now() + (FRAME_MAX_AGE - 60) * 1000)).toEqual({
      listed: 3,
      deleted: 0,
      pages: 1,
    });
  });

  it('handles more than one full page (1,000 objects)', async () => {
    await putFrames(frameKeys(1001));
    const result = await sweep(env.FRAMES, Date.now() + HOUR_AND_A_BIT);
    expect(result).toEqual({ listed: 1001, deleted: 1001, pages: 2 });
    expect(await remaining('frames/')).toEqual([]);
  });

  it('runs from the cron trigger and logs one sweep line', async () => {
    await putFrames(frameKeys(4));
    const logs = captureLogs();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + HOUR_AND_A_BIT);
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ cron: '*/15 * * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await remaining('frames/')).toEqual([]);
    const records = logs.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'sweep', listed: 4, deleted: 4, pages: 1 });
    expect(Object.keys(v.parse(v.looseObject({ ms: v.number() }), records[0])).sort()).toEqual([
      'deleted',
      'event',
      'listed',
      'ms',
      'pages',
    ]);
  });
});
