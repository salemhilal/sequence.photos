// GET (and HEAD) /frames/:id/:i.jpg: serve a frame to Instagram's fetcher.
// Public, no auth: the unguessable batch id is the secret. See README "GET /frames".

import { isBatchId, parseFrameIndex } from './formats';
import { HttpError } from './http';
import { FRAME_MAX_AGE } from './keys';
import { Tag } from './log';
import type { Handler } from './router';
import { frameKey } from './uploads';

const FRAME_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'image/jpeg',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Content-Disposition': 'inline',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

export const getFrame: Handler = async (ctx) => {
  const id = ctx.params.id;
  // Malformed ids and indexes can't name a frame: 404 like any other missing one.
  if (!isBatchId(id)) throw new HttpError(404, 'not_found');
  ctx.log.batch = await Tag.batch(id);
  const index = parseFrameIndex(ctx.params.i, ctx.config.maxFrames);
  if (index === null) throw new HttpError(404, 'not_found');
  ctx.log.i = index;

  const key = frameKey(id, index);
  const head = ctx.request.method === 'HEAD';
  let object: R2Object | null;
  let body: ReadableStream | null = null;
  if (head) {
    object = await ctx.env.FRAMES.head(key);
  } else {
    const full = await ctx.env.FRAMES.get(key);
    object = full;
    body = full?.body ?? null;
  }
  if (!object) throw new HttpError(404, 'not_found');
  const isFresh = object.uploaded.getTime() >= (ctx.now - FRAME_MAX_AGE) * 1000;
  // Older than an hour: gone, even if the sweep hasn't run yet.
  if (!isFresh) {
    await body?.cancel();
    throw new HttpError(404, 'expired');
  }
  ctx.log.bytes = object.size;

  const headers = { ...FRAME_HEADERS, 'Content-Length': String(object.size) };
  return new Response(body, { status: 200, headers });
};
