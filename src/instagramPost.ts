import type { PostResult, UploadBatch, UploadsRequest } from '../server/src/api';
import { INSTAGRAM } from './config';
import { isRecord } from './guards';
import { freshConnection, markNeedsReconnect, RECONNECT, SERVER_ERROR, type InstagramConnection } from './instagram';
import {
  LIMITS,
  postImageLayout,
  renderPostImage,
  slideSize,
  type Fit,
  type PostKind,
  type Slide,
} from './instagramImage';
import type { Project, Sheet } from './types';

/**
 * Posting to Instagram: a feed post (one image, or a carousel) or stories, from a
 * project's frames or pages. The app talks to Instagram's API directly; Sequence's server
 * only holds the images briefly at public URLs, because Instagram fetches images by URL. See
 * sequence-server's README, "The app's side". The images are made in instagramImage.ts.
 */

/** A failure to show the user as is. */
class PostError extends Error {}

// --- Instagram's API ------------------------------------------------------------------

interface GraphError {
  code?: number;
  error_user_msg?: string;
}

/** What to tell the user about an Instagram error (by its code, from Meta's docs). */
export function graphErrorMessage(error: GraphError | null, status: number): string {
  const code = error?.code;
  if (code === 190) return 'Your Instagram connection expired. Connect again in Settings.';
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 9) {
    return 'Instagram’s posting limit was reached. Try again later.';
  }
  if (code === 10 || code === 200) return 'Sequence doesn’t have permission to post. Connect again in Settings.';
  if (code === 9004) return 'Instagram couldn’t fetch the images. Try again in a moment.';
  if (code === 36003) return 'Instagram doesn’t accept this image shape. Try cropping or expanding the slides.';
  if (error?.error_user_msg) return error.error_user_msg;
  return `Instagram couldn’t post this (${code === undefined ? `HTTP ${status}` : `error ${code}`}).`;
}

/** Cancelled by the user (the pane says nothing more). */
export class CancelledError extends PostError {
  constructor() {
    super('Cancelled.');
  }
}

/** Throws if the user has cancelled. */
function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

/**
 * Instagram may send ids as bare JSON numbers longer than a JavaScript number holds
 * exactly; they're quoted before parsing to keep every digit.
 */
export function quoteIds(text: string): string {
  return text.replace(/("(?:id|user_id)"\s*:\s*)(\d+)/g, '$1"$2"');
}

/**
 * A call to Instagram's API with the token as a parameter (not a header), so requests stay
 * "simple" CORS requests: `graph.instagram.com` refuses preflights. Cancelling aborts it.
 */
async function graph(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  check(signal);
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${INSTAGRAM.graphUrl}/${path}?${body}` : `${INSTAGRAM.graphUrl}/${path}`;
  let res: Response;
  let text: string;
  try {
    res = method === 'GET' ? await fetch(url, { signal }) : await fetch(url, { method, body, signal });
    text = await res.text();
  } catch {
    check(signal);
    throw new PostError('Couldn’t reach Instagram. Check your connection and try again.');
  }
  let json: unknown = null;
  try {
    json = JSON.parse(quoteIds(text));
  } catch {
    // Not JSON: an error below.
  }
  if (res.ok && isRecord(json)) return json;
  const error = isRecord(json) && isRecord(json.error) ? json.error : null;
  if (error?.code === 190) markNeedsReconnect();
  throw new PostError(
    graphErrorMessage(
      error && {
        ...(typeof error.code === 'number' && { code: error.code }),
        ...(typeof error.error_user_msg === 'string' && { error_user_msg: error.error_user_msg }),
      },
      res.status,
    ),
  );
}

function idOf(json: Record<string, unknown>): string {
  const id = json.id;
  if (typeof id !== 'string' || !id) throw new PostError('Instagram sent an unexpected answer.');
  return id;
}

/** Waits, or rejects as soon as the user cancels (including if they already have). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Waits until Instagram has fetched and processed a container: checking soon, then less
 * often (Meta suggests about once a minute, for up to 5 minutes).
 */
async function waitUntilReady(token: string, container: string, signal?: AbortSignal): Promise<void> {
  const started = Date.now();
  for (const delay of [1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000, 60000, 60000, 60000, 60000]) {
    const json = await graph(token, 'GET', container, { fields: 'status_code' }, signal);
    const status = json.status_code;
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new PostError('Instagram couldn’t process the images. Try again in a moment.');
    }
    if (Date.now() - started > 5 * 60 * 1000) break;
    await sleep(delay, signal);
  }
  throw new PostError('Instagram is taking too long to process the post. Try again later.');
}

// --- Sequence's server ------------------------------------------------------------------

function parseBatch(v: unknown, count: number): UploadBatch | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.delete !== 'string' || !Array.isArray(v.frames)) {
    return null;
  }
  const frames = v.frames.flatMap((f: unknown) =>
    isRecord(f) && typeof f.put === 'string' && typeof f.url === 'string' ? [{ put: f.put, url: f.url }] : [],
  );
  return frames.length === count ? { id: v.id, frames, delete: v.delete } : null;
}

async function startUpload(connection: InstagramConnection, count: number, signal?: AbortSignal): Promise<UploadBatch> {
  let res: Response;
  try {
    res = await fetch(`${connection.server}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ enrollment: connection.enrollment, count } satisfies UploadsRequest),
      signal,
    });
  } catch {
    check(signal);
    throw new PostError(SERVER_ERROR);
  }
  if (res.status === 401) {
    markNeedsReconnect();
    throw new PostError(RECONNECT);
  }
  if (res.status === 429) throw new PostError('Too many posts in a row. Wait a minute and try again.');
  const batch = res.ok ? parseBatch(await res.json().catch(() => null), count) : null;
  if (!batch) throw new PostError(`The Sequence server couldn’t take the images (HTTP ${res.status}).`);
  return batch;
}

async function uploadFrame(put: string, image: Blob, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(put, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image, signal });
  } catch {
    check(signal);
    throw new PostError(SERVER_ERROR);
  }
  if (!res.ok) throw new PostError(`The Sequence server refused an image (HTTP ${res.status}).`);
}

// --- Posting ----------------------------------------------------------------------------

export type PostStep =
  | { step: 'preparing'; done: number; total: number }
  | { step: 'uploading'; done: number; total: number }
  | { step: 'processing' }
  | { step: 'publishing'; done: number; total: number };

interface PostOptions {
  slides: readonly Slide[];
  sheet: Sheet;
  photos: Readonly<Project['photos']>;
  kind: PostKind;
  fit: Fit;
  caption: string;
  /** Told how many photos had to be drawn from their previews (originals that wouldn't decode here). */
  onPreviews?: (count: number) => void;
  onStep: (step: PostStep) => void;
  signal?: AbortSignal;
}

/**
 * Posts slides to Instagram: renders them, hands them to Sequence's server for Instagram
 * to fetch, creates the post (one image, a carousel, or one story per slide), waits until
 * Instagram has processed all of it, and publishes. Cancelling works until publishing
 * starts: everything before it is checked for a cancel, and nothing is published until
 * every part is ready. The server's copies are deleted afterwards however it went.
 * Resolves to the post's link (the first story's, for stories).
 */
export async function postToInstagram(options: PostOptions): Promise<string | null> {
  const { slides, sheet, photos, kind, fit, caption, onStep, signal } = options;
  if (slides.length === 0) throw new PostError('There are no slides to post.');
  if (slides.length > LIMITS.maxItems) {
    throw new PostError(`Instagram posts up to ${LIMITS.maxItems} slides at a time.`);
  }

  const connection = await freshConnection();
  const token = connection.token;
  const user = connection.userId;

  // Within the daily limit? (If this check fails, publishing reports it anyway.)
  const needed = kind === 'story' ? slides.length : 1;
  let quota: { used: number; total: number } | null = null;
  try {
    const limit = await graph(
      token,
      'GET',
      `${user}/content_publishing_limit`,
      { fields: 'quota_usage,config' },
      signal,
    );
    const data: unknown = Array.isArray(limit.data) ? limit.data[0] : null;
    if (isRecord(data) && isRecord(data.config)) {
      const used = data.quota_usage;
      const total = data.config.quota_total;
      if (typeof used === 'number' && typeof total === 'number') quota = { used, total };
    }
  } catch (error) {
    if (error instanceof CancelledError) throw error;
  }
  if (quota && quota.used + needed > quota.total) {
    throw new PostError(
      `Instagram allows ${quota.total} posts a day through apps, and that’s been reached. Try again later.`,
    );
  }

  const layout = postImageLayout(slideSize(sheet), kind, fit);
  const images: Blob[] = [];
  let previews = 0;
  for (const [i, slide] of slides.entries()) {
    check(signal);
    onStep({ step: 'preparing', done: i, total: slides.length });
    const image = await renderPostImage(slide, sheet, photos, layout);
    if (!image) throw new PostError('A slide is too detailed to fit Instagram’s 8 MB limit.');
    images.push(image.blob);
    previews += image.previews;
  }
  if (previews) options.onPreviews?.(previews);

  check(signal);
  const batch = await startUpload(connection, images.length, signal);
  // Sent with the delete, so the server can count posts.
  let result: PostResult = 'failed';
  try {
    for (const [i, image] of images.entries()) {
      check(signal);
      onStep({ step: 'uploading', done: i, total: images.length });
      const frame = batch.frames[i];
      if (frame) await uploadFrame(frame.put, image, signal);
    }
    onStep({ step: 'processing' });

    // Every container is created and processed before anything is published.
    const urls = batch.frames.map((f) => f.url);
    const create = (params: Record<string, string>) => graph(token, 'POST', `${user}/media`, params, signal).then(idOf);
    let toPublish: string[];
    if (kind === 'story') {
      toPublish = [];
      for (const image_url of urls) toPublish.push(await create({ image_url, media_type: 'STORIES' }));
    } else if (urls.length === 1 && urls[0]) {
      toPublish = [await create({ image_url: urls[0], caption })];
    } else {
      const children: string[] = [];
      for (const image_url of urls) children.push(await create({ image_url, is_carousel_item: 'true' }));
      for (const child of children) await waitUntilReady(token, child, signal);
      toPublish = [await create({ media_type: 'CAROUSEL', children: children.join(','), caption })];
    }
    for (const container of toPublish) await waitUntilReady(token, container, signal);
    check(signal);

    // Publishing: no cancelling from here (the pane hides Cancel), and a failure partway
    // says what's already up.
    const published: string[] = [];
    for (const [i, container] of toPublish.entries()) {
      onStep({ step: 'publishing', done: i, total: toPublish.length });
      try {
        published.push(idOf(await graph(token, 'POST', `${user}/media_publish`, { creation_id: container })));
        result = 'posted';
      } catch (error) {
        if (published.length === 0) throw error;
        const why = error instanceof Error ? ` ${error.message}` : '';
        throw new PostError(`${published.length} of ${toPublish.length} stories were posted, then it stopped.${why}`);
      }
    }
    const first = published[0];
    if (!first) return null;
    try {
      const link = await graph(token, 'GET', first, { fields: 'permalink' });
      return typeof link.permalink === 'string' ? link.permalink : null;
    } catch {
      return null;
    }
  } catch (error) {
    if (error instanceof CancelledError) result = 'cancelled';
    throw error;
  } finally {
    // The server deletes them within the hour anyway; this is sooner.
    const url = new URL(batch.delete);
    url.searchParams.set('result', result);
    void fetch(url, { method: 'DELETE' }).catch(() => undefined);
  }
}
