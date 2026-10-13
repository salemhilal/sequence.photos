import { INSTAGRAM } from './config';
import { renderFrame } from './frames';
import { freshConnection, type InstagramConnection } from './instagram';
import { serverUrl } from './server';
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

/** Whether a frame of this size can be a feed image as it is. */
export function fitsFeed(size: Size): boolean {
  const r = size.w / size.h;
  return r >= LIMITS.minRatio - 1e-9 && r <= LIMITS.maxRatio + 1e-9;
}

/** The nearest shape the feed takes, as width / height. */
export function feedRatio(size: Size): number {
  return Math.min(LIMITS.maxRatio, Math.max(LIMITS.minRatio, size.w / size.h));
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
 * How a frame becomes an image for Instagram. Feed posts outside 4:5 to 1.91:1 are cropped
 * (centered) or expanded with white margins to the nearest allowed shape; stories keep
 * their shape (Instagram fits them to the screen). Then the image is scaled to Instagram's
 * widths (320 to 1440 px) and the server's height limit.
 */
export function postImageLayout(size: Size, kind: PostKind, fit: Fit): PostImageLayout {
  let source: Rect = { x: 0, y: 0, w: size.w, h: size.h };
  let canvas = { w: size.w, h: size.h };
  if (kind === 'feed' && !fitsFeed(size)) {
    const r = feedRatio(size);
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
  const width = Math.round(canvas.w * scale);
  const height = Math.round(canvas.h * scale);
  const w = source.w * scale;
  const h = source.h * scale;
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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

/**
 * A call to Instagram's API with the token as a parameter (not a header), so requests stay
 * "simple" CORS requests: `graph.instagram.com` refuses preflights.
 */
async function graph(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${INSTAGRAM.graphUrl}/${path}?${body}` : `${INSTAGRAM.graphUrl}/${path}`;
  let res: Response;
  try {
    res = method === 'GET' ? await fetch(url) : await fetch(url, { method, body });
  } catch {
    throw new PostError('Couldn’t reach Instagram. Check your connection and try again.');
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok && isRecord(json)) return json;
  const error = isRecord(json) && isRecord(json.error) ? json.error : null;
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
  if (typeof id !== 'string' && typeof id !== 'number') throw new PostError('Instagram sent an unexpected answer.');
  return String(id);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new PostError('Cancelled.'));
    });
  });

/**
 * Waits until Instagram has fetched and processed a container: checking soon, then less
 * often (Meta suggests about once a minute, for up to 5 minutes).
 */
async function waitUntilReady(token: string, container: string, signal?: AbortSignal): Promise<void> {
  const started = Date.now();
  for (const delay of [1000, 2000, 3000, 5000, 8000, 13000, 21000, 30000, 60000, 60000, 60000, 60000]) {
    const json = await graph(token, 'GET', container, { fields: 'status_code' });
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

const SERVER_UNREACHABLE = 'Couldn’t connect to the Sequence server. Check the server in Settings → Advanced.';

async function startUpload(connection: InstagramConnection, count: number): Promise<UploadBatch> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ enrollment: connection.enrollment, count }),
    });
  } catch {
    throw new PostError(SERVER_UNREACHABLE);
  }
  if (res.status === 401) throw new PostError('Your Instagram connection needs renewing. Connect again in Settings.');
  if (res.status === 429) throw new PostError('Too many posts in a row. Wait a minute and try again.');
  const batch = res.ok ? parseBatch(await res.json().catch(() => null), count) : null;
  if (!batch) throw new PostError(`The Sequence server couldn’t take the images (HTTP ${res.status}).`);
  return batch;
}

async function uploadFrame(put: string, image: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(put, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: image });
  } catch {
    throw new PostError(SERVER_UNREACHABLE);
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
 * to fetch, creates the post (one image, a carousel, or one story per frame), waits for
 * Instagram to process it, and publishes. The server's copies are deleted afterwards
 * however it went. Resolves to the post's link (the first story's, for stories).
 */
export async function postToInstagram(options: PostOptions): Promise<string | null> {
  const { frames, size, kind, fit, caption, onStep, signal } = options;
  if (frames.length === 0) throw new PostError('There are no frames to post.');
  if (kind === 'feed' && frames.length > LIMITS.maxItems) {
    throw new PostError(`Instagram posts up to ${LIMITS.maxItems} frames at a time.`);
  }
  const check = () => {
    if (signal?.aborted) throw new PostError('Cancelled.');
  };

  const connection = await freshConnection();
  const token = connection.token;

  // Within the daily limit? (If this check fails, publishing reports it anyway.)
  try {
    const limit = await graph(token, 'GET', `${connection.userId}/content_publishing_limit`, {
      fields: 'quota_usage,config',
    });
    const data: unknown = Array.isArray(limit.data) ? limit.data[0] : null;
    if (isRecord(data) && isRecord(data.config)) {
      const used = data.quota_usage;
      const total = data.config.quota_total;
      if (
        typeof used === 'number' &&
        typeof total === 'number' &&
        used + (kind === 'story' ? frames.length : 1) > total
      ) {
        throw new PostError(
          `Instagram allows ${total} posts a day through apps, and that’s been reached. Try again later.`,
        );
      }
    }
  } catch (error) {
    if (error instanceof PostError && error.message.startsWith('Instagram allows')) throw error;
  }

  const layout = postImageLayout(size, kind, fit);
  const images: Blob[] = [];
  for (const [i, frame] of frames.entries()) {
    check();
    onStep({ step: 'preparing', done: i, total: frames.length });
    images.push(await renderPostImage(frame, size, layout));
  }

  const batch = await startUpload(connection, images.length);
  try {
    for (const [i, image] of images.entries()) {
      check();
      onStep({ step: 'uploading', done: i, total: images.length });
      const frame = batch.frames[i];
      if (frame) await uploadFrame(frame.put, image);
    }
    check();
    onStep({ step: 'processing' });

    const urls = batch.frames.map((f) => f.url);
    const user = connection.userId;
    // What to publish: one container (an image or a carousel), or one per story.
    let toPublish: string[];
    if (kind === 'story') {
      toPublish = [];
      for (const image_url of urls) {
        toPublish.push(idOf(await graph(token, 'POST', `${user}/media`, { image_url, media_type: 'STORIES' })));
      }
    } else if (urls.length === 1 && urls[0]) {
      toPublish = [idOf(await graph(token, 'POST', `${user}/media`, { image_url: urls[0], caption }))];
    } else {
      const children: string[] = [];
      for (const image_url of urls) {
        children.push(idOf(await graph(token, 'POST', `${user}/media`, { image_url, is_carousel_item: 'true' })));
      }
      for (const child of children) await waitUntilReady(token, child, signal);
      const carousel = { media_type: 'CAROUSEL', children: children.join(','), caption };
      toPublish = [idOf(await graph(token, 'POST', `${user}/media`, carousel))];
    }

    let first: string | null = null;
    for (const [i, container] of toPublish.entries()) {
      await waitUntilReady(token, container, signal);
      // Past this point a post goes up; no cancelling.
      onStep({ step: 'publishing', done: i, total: toPublish.length });
      const media = idOf(await graph(token, 'POST', `${user}/media_publish`, { creation_id: container }));
      first ??= media;
    }
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
