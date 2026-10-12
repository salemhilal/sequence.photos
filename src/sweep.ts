// The scheduled sweep: delete frames over an hour old. See README "Scheduled sweep".
// An R2 lifecycle rule (whole days only) is the second backstop.

import { FRAME_MAX_AGE } from './keys';
import { errorName, log } from './log';

export interface SweepResult {
  listed: number;
  deleted: number;
  pages: number;
}

/** R2's maximum for both `list` and `delete`. */
const PAGE_SIZE = 1000;

/** Lists `frames/` page by page and deletes each page's old objects in one call. */
export async function sweep(
  bucket: R2Bucket,
  nowMs: number,
  pageSize = PAGE_SIZE,
): Promise<SweepResult> {
  const cutoff = nowMs - FRAME_MAX_AGE * 1000;
  const result: SweepResult = { listed: 0, deleted: 0, pages: 0 };
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: 'frames/',
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    });
    result.pages++;
    result.listed += page.objects.length;
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
    if (old.length > 0) await bucket.delete(old);
    result.deleted += old.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
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
