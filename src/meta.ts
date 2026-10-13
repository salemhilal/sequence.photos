// Meta's required callbacks: POST /meta/deauthorize, POST /meta/data-deletion, and the
// GET /meta/deletion status page. See README "Meta's required callbacks".
//
// The server keeps nothing per user, so there's nothing to delete: these verify the
// request, then answer.

import * as v from 'valibot';
import { HttpError, jsonResponse, readBody, type Handler } from './http';
import { decodeUtf8, fromBase64Url, randomBase64Url, utf8 } from './encoding';

/** Form bodies from Meta are small. Larger → 413. */
export const MAX_SIGNED_REQUEST_BODY = 8 * 1024;

/** How old a signed_request's `issued_at` may be, and how far ahead (clock skew). */
export const ISSUED_AT_MAX_AGE = 24 * 60 * 60;
const ISSUED_AT_MAX_SKEW = 5 * 60;

const SignedRequestPayload = v.looseObject({
  algorithm: v.literal('HMAC-SHA256'),
  issued_at: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  expires: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
});

export type SignedRequestResult =
  { ok: true } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verifies `<base64url sig>.<base64url payload>`: HMAC-SHA256 over the encoded payload
 * with the app secret (constant-time, via crypto.subtle.verify), then the payload's
 * `algorithm` and `issued_at`. The payload's contents (e.g. `user_id`) aren't needed.
 */
export async function verifySignedRequest(
  signedRequest: string,
  appSecret: string,
  now: number,
): Promise<SignedRequestResult> {
  const parts = signedRequest.split('.');
  const [encodedSig, encodedPayload] = parts;
  if (parts.length !== 2 || encodedSig === undefined || encodedPayload === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  const sig = fromBase64Url(encodedSig);
  const payloadBytes = fromBase64Url(encodedPayload);
  if (sig?.byteLength !== 32 || !payloadBytes || payloadBytes.byteLength === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    utf8(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  if (!(await crypto.subtle.verify('HMAC', key, sig, utf8(encodedPayload)))) {
    return { ok: false, reason: 'bad_signature' };
  }

  const text = decodeUtf8(payloadBytes);
  let json: unknown;
  try {
    json = text === null ? undefined : JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const payload = v.safeParse(SignedRequestPayload, json);
  if (!payload.success) return { ok: false, reason: 'malformed' };
  const issuedAt = payload.output.issued_at;
  if (issuedAt < now - ISSUED_AT_MAX_AGE || issuedAt > now + ISSUED_AT_MAX_SKEW) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

/** Reads the form body and verifies its `signed_request`; throws on anything wrong. */
async function requireSignedRequest(
  request: Request,
  appSecret: string,
  now: number,
): Promise<void> {
  const text = decodeUtf8(await readBody(request, MAX_SIGNED_REQUEST_BODY));
  if (text === null) throw new HttpError(400, 'bad_request');
  const signedRequest = new URLSearchParams(text).get('signed_request');
  if (signedRequest === null) throw new HttpError(400, 'bad_request');
  const result = await verifySignedRequest(signedRequest, appSecret, now);
  if (!result.ok) {
    throw new HttpError(400, result.reason === 'malformed' ? 'bad_request' : result.reason);
  }
}

/** `POST /meta/deauthorize`: a user removed the app. Nothing is stored, so: 200. */
export const deauthorize: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'meta' });
  await requireSignedRequest(ctx.request, ctx.env.IG_APP_SECRET, ctx.now);
  return new Response(null, { status: 200 });
};

/** `POST /meta/data-deletion`: answer with a status URL and a confirmation code. */
export const dataDeletion: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'meta' });
  await requireSignedRequest(ctx.request, ctx.env.IG_APP_SECRET, ctx.now);
  // Only for Meta's records: there's no deletion job to look up.
  const code = randomBase64Url(9);
  return jsonResponse({
    url: `${ctx.url.origin}/meta/deletion?code=${code}`,
    confirmation_code: code,
  });
};

const DELETION_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sequence: data deletion</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36em;margin:3em auto;padding:0 1em}</style>
</head>
<body>
<h1>Your data and Sequence</h1>
<p>Sequence's server keeps no personal data. There is no account and no stored token: your
Instagram connection stays on your device.</p>
<p>When you post to Instagram, your frames are uploaded to Sequence's server so Instagram can
fetch them. They are deleted after posting, and automatically within about an hour and a half
otherwise.</p>
<p>So there is nothing left to delete. To revoke Sequence's access to your Instagram account,
remove Sequence in Instagram's settings under Apps and websites.</p>
</body>
</html>
`;

/** `GET /meta/deletion?code=…`: a static status page (the code isn't looked up). */
export const deletionStatus: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'meta' });
  return new Response(DELETION_PAGE, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Frame-Options': 'DENY',
    },
  });
};
