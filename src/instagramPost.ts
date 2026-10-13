import { INSTAGRAM } from './config';
import { renderFrame } from './frames';
import { isRecord } from './guards';
import { freshConnection, markNeedsReconnect, RECONNECT, SERVER_ERROR, type InstagramConnection } from './instagram';
import type { Frame, Size } from './types';

/**
 * Posting a digital sequence to Instagram: a feed post (one image, or a carousel) or
 * stories. The app talks to Instagram's API directly; Sequence's server only holds the
 * frames briefly at public URLs, because Instagram fetches images by URL. See
 * sequence-server's README, "The app's side".
 */

export type PostKind = 'feed' | 'story';
/** How a frame outside the feed's shapes is fitted: trimmed, or given margins. */
export type Fit = 'crop' | 'expand';

/** Instagram's API limits. */
export const LIMITS = {
  /** Feed images: portrait 4:5 to landscape 1.91:1. */
  minRatio: 4 / 5,
  maxRatio: 1.91,
  /** Images per carousel. (The Instagram app allows 20; the API, 10.) */
  maxItems: 10,
  minWidth: 320,
  maxWidth: 1440,
  /** Sequence's server refuses taller images. */
  maxHeight: 2560,
  /** Instagram's limit per image, and the server's. */
  maxBytes: 8 * 1024 * 1024,
  captionLength: 2200,
  hashtags: 30,
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An image as posted: its size, the part of the frame it shows, and where that goes. */
export interface PostImageLayout {
  width: number;
  height: number;
  /** The part of the frame shown, in frame pixels. */
  source: Rect;
  /** Where it's drawn, in image pixels (the rest is white). */
  target: Rect;
}

/**
 * The shapes Instagram takes, as width / height: feed images from 4:5 (tall) to 1.91:1
 * (wide); stories any shape Sequence's server takes once scaled to Instagram's widths
 * (no taller than 320 × 2560).
 */
export function ratioRange(kind: PostKind): { min: number; max: number } {
  return kind === 'feed'
    ? { min: LIMITS.minRatio, max: LIMITS.maxRatio }
    : { min: LIMITS.minWidth / LIMITS.maxHeight, max: Infinity };
}

/** Whether a frame of this size can be posted as it is. */
export function fits(size: Size, kind: PostKind): boolean {
  const { min, max } = ratioRange(kind);
  const r = size.w / size.h;
  return r >= min - 1e-9 && r <= max + 1e-9;
}

/** The nearest shape Instagram takes, as width / height. */
export function targetRatio(size: Size, kind: PostKind): number {
  const { min, max } = ratioRange(kind);
  return Math.min(max, Math.max(min, size.w / size.h));
}

/** A ratio as people say it: 4:5, 1.91:1, or 3:4. */
export function ratioLabel(r: number): string {
  for (const [a, b] of [
    [4, 5],
    [3, 4],
    [1, 1],
    [9, 16],
    [16, 9],
    [2, 3],
    [3, 2],
  ] as const) {
    if (Math.abs(r - a / b) < 0.005) return `${a}:${b}`;
  }
  return `${Math.round(r * 100) / 100}:1`;
}

/**
 * How a frame becomes an image for Instagram. A frame outside the shapes Instagram takes
 * (see ratioRange) is cropped (centered) or expanded with white margins to the nearest
 * one. Then the image is scaled to Instagram's widths (320 to 1440 px) and the server's
 * height limit, rounding so it stays within the allowed shapes.
 */
export function postImageLayout(size: Size, kind: PostKind, fit: Fit): PostImageLayout {
  let source: Rect = { x: 0, y: 0, w: size.w, h: size.h };
  let canvas = { w: size.w, h: size.h };
  const r = targetRatio(size, kind);
  if (!fits(size, kind)) {
    const tall = size.w / size.h < r;
    if (fit === 'crop') {
      source = tall
        ? { x: 0, y: (size.h - size.w / r) / 2, w: size.w, h: size.w / r }
        : { x: (size.w - size.h * r) / 2, y: 0, w: size.h * r, h: size.h };
      canvas = { w: source.w, h: source.h };
    } else {
      canvas = tall ? { w: size.h * r, h: size.h } : { w: size.w, h: size.w / r };
    }
  }
  const scale = Math.max(
    LIMITS.minWidth / canvas.w,
    Math.min(1, LIMITS.maxWidth / canvas.w, LIMITS.maxHeight / canvas.h),
  );
  let width = Math.round(canvas.w * scale);
  let height = Math.round(canvas.h * scale);
  // Rounding mustn't tip the image past an allowed shape (e.g. 1003 × 1254 is under 4:5).
  const { min, max } = ratioRange(kind);
  if (width / height < min) height = Math.floor(width / min);
  if (width / height > max) width = Math.floor(height * max);
  height = Math.min(height, LIMITS.maxHeight);
  const w = Math.min(width, source.w * scale);
  const h = Math.min(height, source.h * scale);
  return { width, height, source, target: { x: (width - w) / 2, y: (height - h) / 2, w, h } };
}

/** Lower qualities to try, in turn, until an image is under Instagram's size limit. */
const QUALITIES = [0.92, 0.85, 0.75, 0.6];

/** One frame as the JPEG Instagram gets. */
export async function renderPostImage(frame: Frame, size: Size, layout: PostImageLayout): Promise<Blob> {
  const { canvas: rendered } = await renderFrame(frame, size.w, size.h);
  const out = new OffscreenCanvas(layout.width, layout.height);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.imageSmoothingQuality = 'high';
  const { source: s, target: t } = layout;
  ctx.drawImage(rendered, s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
  for (const quality of QUALITIES) {
    const blob = await out.convertToBlob({ type: 'image/jpeg', quality });
    if (blob.size <= LIMITS.maxBytes) return blob;
  }
  throw new PostError('A frame is too detailed to fit Instagram’s 8 MB limit.');
}

/** Hashtags in a caption (Instagram allows 30). */
export function hashtagCount(caption: string): number {
  return caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

/** A failure to show the user as is. */
export class PostError extends Error {}

// --- Instagram's API ------------------------------------------------------------------

interface GraphError {
  code?: number;
  error_subcode?: number;
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
  if (code === 36003) return 'Instagram doesn’t accept this image shape. Try cropping or expanding the frames.';
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
        ...(typeof error.error_subcode === 'number' && { error_subcode: error.error_subcode }),
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

interface UploadBatch {
  id: string;
  frames: { put: string; url: string }[];
  delete: string;
}

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
      body: JSON.stringify({ enrollment: connection.enrollment, count }),
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
  if (!res.ok) throw new PostError(`The Sequence server refused a frame (HTTP ${res.status}).`);
}

// --- Posting ----------------------------------------------------------------------------

export type PostStep =
  | { step: 'preparing'; done: number; total: number }
  | { step: 'uploading'; done: number; total: number }
  | { step: 'processing' }
  | { step: 'publishing'; done: number; total: number };

export interface PostOptions {
  frames: readonly Frame[];
  size: Size;
  kind: PostKind;
  fit: Fit;
  caption: string;
  onStep: (step: PostStep) => void;
  signal?: AbortSignal;
}

/**
 * Posts frames to Instagram: renders them, hands them to Sequence's server for Instagram
 * to fetch, creates the post (one image, a carousel, or one story per frame), waits until
 * Instagram has processed all of it, and publishes. Cancelling works until publishing
 * starts: everything before it is checked for a cancel, and nothing is published until
 * every part is ready. The server's copies are deleted afterwards however it went.
 * Resolves to the post's link (the first story's, for stories).
 */
export async function postToInstagram(options: PostOptions): Promise<string | null> {
  const { frames, size, kind, fit, caption, onStep, signal } = options;
  if (frames.length === 0) throw new PostError('There are no frames to post.');
  if (frames.length > LIMITS.maxItems) {
    throw new PostError(`Instagram posts up to ${LIMITS.maxItems} frames at a time.`);
  }

  const connection = await freshConnection();
  const token = connection.token;
  const user = connection.userId;

  // Within the daily limit? (If this check fails, publishing reports it anyway.)
  const needed = kind === 'story' ? frames.length : 1;
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

  const layout = postImageLayout(size, kind, fit);
  const images: Blob[] = [];
  for (const [i, frame] of frames.entries()) {
    check(signal);
    onStep({ step: 'preparing', done: i, total: frames.length });
    images.push(await renderPostImage(frame, size, layout));
  }

  check(signal);
  const batch = await startUpload(connection, images.length, signal);
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
  } finally {
    // The server deletes them within the hour anyway; this is sooner.
    void fetch(batch.delete, { method: 'DELETE' }).catch(() => undefined);
  }
}
