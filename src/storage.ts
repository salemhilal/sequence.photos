// Where frames live in R2, and how long. See README "Frames".

/** Every frame's key starts with this. */
export const FRAMES_PREFIX = 'frames/';

/**
 * How long a frame is served after upload (by R2's `uploaded` time), and the age past
 * which the sweep deletes it. Leaves room for Meta's recommended container polling.
 */
export const FRAME_MAX_AGE = 60 * 60;

/** The R2 key for a frame, built only from validated parts. */
export function frameKey(id: string, index: number): string {
  return `${FRAMES_PREFIX}${id}/${index}.jpg`;
}

/** The prefix for a batch's frames. The strict id format keeps it from matching others. */
export function batchPrefix(id: string): string {
  return `${FRAMES_PREFIX}${id}/`;
}

export interface DeleteResult {
  listed: number;
  deleted: number;
  pages: number;
}

/** R2's maximum for both `list` and `delete`. */
const PAGE_SIZE = 1000;

/**
 * Lists `prefix` page by page and deletes each page's objects (except those `keep`
 * returns true for) in one call.
 */
export async function deleteWhere(
  bucket: R2Bucket,
  prefix: string,
  keep: (object: R2Object) => boolean = () => false,
  pageSize = PAGE_SIZE,
): Promise<DeleteResult> {
  const result: DeleteResult = { listed: 0, deleted: 0, pages: 0 };
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: pageSize, ...(cursor ? { cursor } : {}) });
    result.pages++;
    result.listed += page.objects.length;
    const keys = page.objects.filter((o) => !keep(o)).map((o) => o.key);
    if (keys.length > 0) await bucket.delete(keys);
    result.deleted += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
}
