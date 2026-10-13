// Upload batches: POST /uploads, PUT /uploads/:id/:i.jpg, DELETE /uploads/:id.
// See README "Frames".

import * as v from 'valibot';
import type { UploadBatch } from './api';
import { Enrollment, isBatchId, parseBearer, parseExp, parseFrameIndex } from './formats';
import { contentLength, HttpError, jsonResponse, MAX_JSON_BODY, readBody, readJson } from './http';
import { getMe } from './instagram';
import { checkJpeg, MAX_FRAME_BYTES } from './jpeg';
import { randomBase64Url } from './encoding';
import { LIFETIME, readEnrollment, sign, verify, type Signed } from './keys';
import { Tag } from './log';
import type { Handler, RequestContext } from './router';
import { batchPrefix, deleteWhere, frameKey } from './storage';

const UploadsBody = v.strictObject({
  enrollment: Enrollment,
  count: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

/** `POST /uploads`: start a batch for an enrolled user with a matching token. */
export const createBatch: Handler = async (ctx) => {
  const token = parseBearer(ctx.request.headers.get('Authorization'));
  if (token === null) throw new HttpError(401, 'unauthorized');
  const body = await readJson(ctx.request, MAX_JSON_BODY, UploadsBody);
  if (body.count > ctx.config.maxFrames) throw new HttpError(400, 'bad_request');

  // The enrollment first: it's local and cheap, and stops strangers before Instagram.
  const enrollment = await readEnrollment(ctx.keys, body.enrollment, ctx.now);
  if (!enrollment.ok) {
    throw new HttpError(401, enrollment.reason === 'expired' ? 'expired' : 'bad_signature');
  }
  ctx.log.user = await Tag.user(ctx.keys.log, enrollment.userId);
  await ctx.rateLimit({ kind: 'user', userId: enrollment.userId });

  const me = await getMe(ctx.config, token);
  if (!me.ok) {
    throw me.failure === 'unavailable'
      ? new HttpError(502, 'instagram_unavailable')
      : new HttpError(401, 'unauthorized');
  }
  if (me.value.userId !== enrollment.userId) throw new HttpError(401, 'enrollment_mismatch');

  // 128 random bits: 22 base64url characters.
  const id = randomBase64Url(16);
  ctx.log.batch = await Tag.batch(id);
  const origin = ctx.url.origin;

  const frames: UploadBatch['frames'] = [];
  const putExp = ctx.now + LIFETIME.PUT;
  for (let index = 0; index < body.count; index++) {
    const sig = await sign(ctx.keys, { kind: 'PUT', id, index, exp: putExp });
    frames.push({
      put: `${origin}/uploads/${id}/${index}.jpg?exp=${putExp}&sig=${sig}`,
      url: `${origin}/frames/${id}/${index}.jpg`,
    });
  }
  const deleteExp = ctx.now + LIFETIME.DELETE;
  const deleteSig = await sign(ctx.keys, { kind: 'DELETE', id, exp: deleteExp });

  const batch: UploadBatch = {
    id,
    frames,
    delete: `${origin}/uploads/${id}?exp=${deleteExp}&sig=${deleteSig}`,
  };
  return jsonResponse(batch);
};

/** Checks a signed upload URL's `exp` and `sig` against `m` (built from the path). */
async function requireSignature(ctx: RequestContext, m: (exp: number) => Signed): Promise<void> {
  const exp = parseExp(ctx.url.searchParams.get('exp'));
  const sig = ctx.url.searchParams.get('sig');
  if (exp === null || sig === null) throw new HttpError(403, 'bad_signature');
  const result = await verify(ctx.keys, m(exp), sig, ctx.now);
  if (result !== 'ok') throw new HttpError(403, result);
}

/** If-None-Match: * — R2 stores the object only if the key is absent. */
const ONLY_IF_ABSENT = (): Headers => new Headers({ 'If-None-Match': '*' });

/** `PUT /uploads/:id/:i.jpg?exp&sig`: upload one frame, once. */
export const putFrame: Handler = async (ctx) => {
  const id = ctx.params.id;
  if (!isBatchId(id)) throw new HttpError(400, 'bad_request');
  ctx.log.batch = await Tag.batch(id);
  const index = parseFrameIndex(ctx.params.i, ctx.config.maxFrames);
  if (index === null) throw new HttpError(400, 'bad_request');
  ctx.log.i = index;

  await requireSignature(ctx, (exp) => ({ kind: 'PUT', id, index, exp }));

  // Size limits before reading anything.
  const length = contentLength(ctx.request);
  if (length === null) throw new HttpError(411, 'length_required');
  ctx.log.bytes = length;
  if (length > MAX_FRAME_BYTES) throw new HttpError(413, 'too_large');

  // Write once. The head is a cheap early answer for a replayed URL, before reading the
  // body; the conditional put below is what actually guarantees it.
  const key = frameKey(id, index);
  if (await ctx.env.FRAMES.head(key)) throw new HttpError(409, 'exists');

  const body = await readBody(ctx.request, MAX_FRAME_BYTES);
  ctx.log.bytes = body.byteLength;
  const jpeg = checkJpeg(body);
  if (!jpeg.ok) throw new HttpError(415, 'not_jpeg');
  ctx.log.width = jpeg.width;
  ctx.log.height = jpeg.height;

  const stored = await ctx.env.FRAMES.put(key, body, {
    onlyIf: ONLY_IF_ABSENT(),
    // No custom metadata: R2's own `uploaded` time is all the server needs.
    httpMetadata: { contentType: 'image/jpeg' },
  });
  if (!stored) throw new HttpError(409, 'exists');
  return new Response(null, { status: 204 });
};

/** `DELETE /uploads/:id?exp&sig`: delete a batch's frames (204 even if already gone). */
export const deleteBatch: Handler = async (ctx) => {
  const id = ctx.params.id;
  if (!isBatchId(id)) throw new HttpError(400, 'bad_request');
  ctx.log.batch = await Tag.batch(id);
  await requireSignature(ctx, (exp) => ({ kind: 'DELETE', id, exp }));
  await deleteWhere(ctx.env.FRAMES, batchPrefix(id));
  return new Response(null, { status: 204 });
};
