// The scheduled sweep: delete frames over an hour old. See README "Scheduled sweep".
// An R2 lifecycle rule (whole days only) is the second backstop.

import { errorName, log } from './log';
import { deleteWhere, FRAME_MAX_AGE, FRAMES_PREFIX, type DeleteResult } from './storage';

/** Deletes every frame over FRAME_MAX_AGE old, by R2's `uploaded` time. */
export function sweep(bucket: R2Bucket, nowMs: number, pageSize?: number): Promise<DeleteResult> {
  const cutoff = nowMs - FRAME_MAX_AGE * 1000;
  return deleteWhere(bucket, FRAMES_PREFIX, (o) => o.uploaded.getTime() >= cutoff, pageSize);
}

/** The cron handler: one `sweep` log line per run; failures logged by name and rethrown. */
export async function runSweep(env: Env): Promise<void> {
  const started = Date.now();
  try {
    const result = await sweep(env.FRAMES, started);
    log({ event: 'sweep', ...result, ms: Date.now() - started });
  } catch (error) {
    log({ event: 'exception', route: 'scheduled', name: errorName(error) });
    throw error;
  }
}
