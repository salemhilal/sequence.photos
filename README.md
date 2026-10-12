# sequence-server

The server side of [Sequence](https://sequence.photos), for posting digital sequences to
Instagram. This README is the plan: everything a fresh session needs to build it.

- **App repo:** `salemhilal/sequence.photos`, checked out at `~/Code/photobook-sequencer`.
  It's a Vite + React + TypeScript app (website at `sequence.photos/app/`, and a Tauri
  Mac app from the same code).
- **This repo:** `salemhilal/sequence-server` (private), at `~/Code/sequence-server`.

## Background

Sequence is a tool for laying out photo sequences. A project is either a **print book**
(spreads, in inches) or a **digital sequence** (single frames, in pixels; 1080 × 1440 by
default, with Instagram presets). The app already renders a digital sequence's frames as
JPEGs (`src/frames.ts`, `renderFrames`). This work adds **posting a digital sequence to
Instagram**:

- **Enroll** in the app's Settings: connect an Instagram account.
- **Post** from the File menu ("Post to Instagram…"), shown only when connected and the
  project is digital.

Constraints that shaped this design:

- **No Facebook.** Users sign in with Instagram alone (_Instagram API with Instagram
  Login_), which works for Instagram **professional accounts (Business or Creator)**
  without a linked Facebook Page. Facebook Login is ruled out, even though it could run
  without a server. The authorize URL sets `enable_fb_login=false` (it defaults to
  showing a Facebook option).
- **Instagram Login's code exchange needs the app's secret**, which can't ship in the
  website or the Mac app. So a server does that one step.
- **Instagram fetches images by URL** (`image_url`); there is no direct upload for
  images. So frames must be at public URLs while Instagram fetches them. The server holds
  them briefly.
- **Free hosting.** The website is on Netlify's free plan, whose credits are shared
  across the account and pause every site when spent, so the server runs elsewhere:
  **Cloudflare Workers + R2** (free tiers: 100,000 requests/day, hard-failing above that
  rather than billing; R2 10 GB storage, free egress, strongly consistent so a frame is
  readable everywhere as soon as it's written; KV was rejected because its writes take
  up to a minute to reach other locations). R2 needs a payment method on file, so R2
  operations past the free tier would be billed: the design keeps them bounded (see
  Abuse).

## Principles

1. **The only state is frames, briefly.** No database, no accounts, no stored tokens,
   no captions. Frames live in R2 for minutes and are deleted after posting, with a
   scheduled sweep as backstop. Everything else the server needs to remember travels in
   values it has signed or sealed, and **the server sets every expiry** inside them.
2. **The app talks to Instagram directly** for everything that doesn't need the secret:
   creating media containers, publishing, refreshing tokens, reading the publishing
   limit. `graph.instagram.com` answers cross-origin requests
   (`Access-Control-Allow-Origin: *`; verified), but its preflight fails (`OPTIONS` →
   500), so the app passes the token as the `access_token` query or form parameter (not
   an `Authorization` header) to keep requests "simple". So captions, post contents,
   and routine account requests never touch our server.
3. **Only Sequence's enrolled users can upload.** A valid Instagram token alone isn't
   enough (tokens from any developer's Instagram app pass `/me`). Uploads need the token
   **and** an enrollment credential the server signed at sign-in, for the same Instagram
   user. No bundled "app secret": it would be extractable from the website's JS or the
   Mac binary.
4. **No usable token in any URL.** The sign-in redirect carries only a sealed bundle
   that's useless without a secret the app kept (PKCE-style), so an intercepted redirect
   (another app claiming the URL scheme, browser history, extensions) gets nothing.
5. **Log enough to debug, never a secret.** Cloudflare's automatic request logs record
   full URLs (which here contain codes, signatures, and frame ids), so they're off; the
   Worker writes its own log line per request instead, with every secret stripped (see
   Logging).

## Strict TypeScript

TypeScript, strict, with no `any` anywhere:

- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`,
  `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`,
  `"noFallthroughCasesInSwitch": true`, `"verbatimModuleSyntax": true`.
- Lint (oxlint or typescript-eslint) with `no-explicit-any`, `no-unsafe-*`, and
  `no-non-null-assertion` as errors.
- **Every external input** (Instagram responses, request bodies, query parameters, Meta
  `signed_request`s) is parsed from `unknown`/`string` with type guards or a small schema
  library (e.g. `valibot`); never cast with `as`.
- Types: `wrangler types` (or `@cloudflare/workers-types`), Worker `Env` typed from
  `wrangler.jsonc`.

## Secrets and keys

Secrets (via `wrangler secret put`, never committed):

- `IG_APP_SECRET`: the Instagram app's secret.
- `SERVER_SECRET`: 32+ random bytes. Separate keys are derived from it with HKDF-SHA256,
  one per purpose (labels `sequence/v1/seal`, `sequence/v1/enroll`,
  `sequence/v1/upload`, and `sequence/v1/log` for log hashes), so a value made for one
  purpose can't be passed off as another. Derive once per isolate and cache the
  `CryptoKey`s.

Signed values: `base64url(payload) + "." + base64url(HMAC-SHA256(key, versioned message))`.
Verify with `crypto.subtle.verify` (constant time), never a hand-written comparison.
Messages are versioned and domain-separated, e.g. `v1\nPUT\n<id>\n<i>\n<exp>`. Every
verifier also rejects an `exp` in the past **or further in the future than that value's
lifetime allows** (a backstop against bugs or a leaked key).

## Sign-in

### What the app does first

1. Make a random **nonce** and a random **verifier** (each 32 bytes, base64url). Keep
   both in `sessionStorage` (single use). Compute
   `challenge = base64url(SHA-256(verifier))`.
2. Open
   `https://www.instagram.com/oauth/authorize?client_id=<IG app id>&redirect_uri=<CALLBACK_URL>&response_type=code&scope=instagram_business_basic,instagram_business_content_publish&enable_fb_login=false&state=<state>`
   where `state = <client>.<nonce>.<challenge>`.

`client` names where to send the user back, from a fixed allowlist (env `RETURN_URLS`,
a JSON map), e.g. `web` → `https://sequence.photos/app/`. The **production** Worker's
allowlist has only production URLs: `dev` (`http://localhost:5175/app/`) lives in a
separate `dev` environment (its own Worker, secrets, and ideally its own Meta app). Never
a wildcard (e.g. `*.netlify.app` for deploy previews). The Mac app, later: prefer an
https Universal Link (Associated Domains) over a `sequence://` scheme, which any app can
claim (the sealed handoff makes interception harmless either way).

### `GET /auth/callback`

Instagram redirects here (this URL is the Meta app's registered OAuth redirect URI,
exactly). The authorization code is single-use and valid for 1 hour.

1. Parse `state`: `client` must be in `RETURN_URLS` (else `400`, plain text, **no
   redirect**: no open redirect); `nonce` and `challenge` must match
   `^[A-Za-z0-9_-]{43}$`. Strip a trailing `#_` Instagram may append to `code`.
2. If Instagram sent `?error=…` (e.g. the user cancelled), redirect to the return URL
   with `#instagram_error=cancelled&state=<state>`.
3. `POST https://api.instagram.com/oauth/access_token` (form: `client_id`,
   `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`). The
   response is `{ data: [{ access_token, user_id, permissions }] }` — read `data[0]`.
   Check `permissions` includes `instagram_business_content_publish`.
4. `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`
   → long-lived token, `expires_in` (~60 days).
5. `GET https://graph.instagram.com/<version>/me?fields=user_id,username,account_type&access_token=…`.
   Use **this** `user_id` (the professional account's id) everywhere, not the one from
   step 3. If the account can't publish (not Business or Creator), redirect with
   `#instagram_error=not_professional`.
6. Build the `InstagramConnection` (below), including a fresh **enrollment**
   credential, and **seal** it: AES-256-GCM with the `seal` key, random 96-bit IV, over
   JSON `{ v: 1, connection, challenge, exp: now + 300 }`.
7. Redirect (`303`) to `<return URL>#instagram=<base64url(iv + ciphertext)>&state=<state>`.

Errors: `#instagram_error=<code>&state=<state>` with codes `cancelled`,
`exchange_failed`, `missing_permission`, `not_professional`. Never include Instagram's
error text. Headers on every response: `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`.

### `POST /auth/redeem`

Body `{ sealed, verifier }` (JSON, ≤ 4 KB). Decrypt `sealed`; check `exp` and that
`base64url(SHA-256(verifier)) === challenge`. Return the `InstagramConnection` as JSON
(`Cache-Control: no-store`). Anything wrong → `400` with no detail.

### What the app does on return

1. Read the fragment, then **immediately** strip it (`history.replaceState`).
2. The `state`'s nonce must match the pending nonce in `sessionStorage`; otherwise
   ignore the fragment entirely (login CSRF: an attacker's link must not connect the
   victim's app to the attacker's account). Clear the pending values either way.
3. `POST /auth/redeem` with the sealed value and the stored verifier; save the
   connection.

### Enrollment and `POST /auth/renew`

The **enrollment** credential is a signed value (key `enroll`) over
`v1\nENROLL\n<userId>\n<exp>`, with `exp = now + 60 days`. It's what makes a token
"Sequence's": uploads require it.

When the app refreshes its Instagram token (below), it also renews the enrollment:
`POST /auth/renew` with body `{ enrollment }` and `Authorization: Bearer <token>`. The
server checks the enrollment's signature (allowing it to be expired by up to 30 days),
then calls `/me?fields=user_id` with the token; the `user_id` must match. Returns a new
enrollment. If the enrollment is too old, the user reconnects.

## Frames

### `POST /uploads`

Start an upload batch. `Authorization: Bearer <instagram token>`, JSON body
`{ enrollment, count }` with `count` from 1 to `MAX_FRAMES` (a var, `10` to start: the
API's documented carousel limit; see Open questions).

1. Verify the enrollment (signature, expiry).
2. `GET graph.instagram.com/<version>/me?fields=user_id&access_token=…`; it must succeed
   and its `user_id` must equal the enrollment's. Else `401`. Don't store or log the
   token.
3. Make the batch `id`: 128 random bits as base64url (exactly 22 characters).
4. Return `UploadBatch`:
   - `frames[i].put`: `PUT /uploads/<id>/<i>.jpg?exp=<unix>&sig=<…>`, signed with the
     `upload` key over `v1\nPUT\n<id>\n<i>\n<exp>`; `exp = now + 30 minutes` (room for
     ten frames on a slow connection).
   - `frames[i].url`: `https://<server>/frames/<id>/<i>.jpg`, the public URL to give
     Instagram as `image_url` (unguessable via `id`).
   - `delete`: `DELETE /uploads/<id>?exp=…&sig=…`, signed over
     `v1\nDELETE\n<id>\n<exp>`, `exp = now + 2 hours`.

### `PUT /uploads/<id>/<i>.jpg?exp&sig`

Upload one frame.

1. `id` must match `^[A-Za-z0-9_-]{22}$` and `i` must be a decimal integer below
   `MAX_FRAMES` without leading zeros (`^(0|[1-9][0-9]?)$`); build the R2 key
   from the parsed values (`frames/<id>/<i>.jpg`). Verify the signature and expiry.
2. `Content-Length` is required and must be ≤ **8 MB** (8,388,608 bytes: Instagram's
   limit for images, so a larger file would fail anyway). Reject before reading.
3. Read the body (`arrayBuffer()`; at most 8 MB) and check it's a real JPEG: starts with
   `FF D8 FF`, ends with `FF D9`, and its markers parse to a start-of-frame segment
   (SOF0–SOF2) whose dimensions are plausible for a frame (width 320–1440 px, height at
   most 2560 px: Instagram scales widths outside 320–1440 rather than refusing them, but
   the app always sends 320–1440, so anything else isn't from Sequence). Reject otherwise
   (`415`).
4. **Write once:** a `head` first (a quick `409` before reading the body), then a
   conditional R2 `put` (`If-None-Match: *`) so an existing object is never replaced;
   `409` if it exists. This stops a leaked or replayed URL from swapping an image after
   the user previewed it, and bounds R2 writes per batch.
5. Store with `httpMetadata.contentType = image/jpeg` and no custom metadata (R2's own
   `uploaded` time is enough). → `204`.

Sizes, for reference (JPEG at quality 0.92): a 1080 × 1350 frame is typically
0.3–0.6 MB and rarely over ~1.2 MB; the largest frame Instagram documents (1440 wide,
4:5: 1440 × 1800) is ~0.5–1 MB, ~2 MB for grainy photos, and ~4–5 MB at quality 1.0.
So 8 MB is ample; the app scales frames wider than 1440 px down to 1440 and lowers the
quality if a frame still doesn't fit.

### `GET /frames/<id>/<i>.jpg`

Serve a frame to Instagram's fetcher (`HEAD` too, with the same checks and headers and
no body). Public (no auth); the id is the secret. Validate `id` and `i` as above. `404`
if missing or **older than 1 hour by R2's `uploaded` time**, even before the sweep runs.
Headers: `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline`,
`Cache-Control: no-store`, `X-Robots-Tag: noindex`. No CORS headers.

Instagram's docs don't say whether it fetches at container creation or at publish, so
the app deletes only after publishing (or giving up), and an hour leaves room for
Meta's recommended polling (up to 5 minutes).

### `DELETE /uploads/<id>?exp&sig`

Delete a batch's frames (the app calls this after publishing, or after giving up).
Validate `id`, verify the signature and expiry, list `frames/<id>/` (the strict `id`
format keeps the prefix from matching other batches) and delete. → `204` (also if
already gone).

### Scheduled sweep (cron, every 15 minutes)

List `frames/` (paginate with the `cursor`; 1,000 per page) and delete objects whose
`uploaded` time is over 1 hour ago. An R2 lifecycle rule (whole days only) deletes
anything over 1 day old as a second backstop, in case the cron fails.

**Retention promise** (privacy policy, `/meta/deletion`): frames are deleted after
posting, and automatically within about an hour and a half otherwise. (GET stops
serving them at 1 hour; the sweep removes them within 15 minutes after that.)

## Meta's required callbacks

For App Review, Meta requires these URLs in the app's settings:

- `POST /meta/deauthorize`: called when a user removes the app.
- `POST /meta/data-deletion`: responds
  `{ "url": "https://<server>/meta/deletion?code=<code>", "confirmation_code": "<code>" }`
  with a random code.
- `GET /meta/deletion?code=…`: a static page: Sequence's server keeps no personal data;
  frames are deleted after posting and automatically within about an hour and a half.

Both POSTs: body `application/x-www-form-urlencoded`, capped at 8 KB, with a
`signed_request` of the form `<sig>.<payload>` (base64url). Verify HMAC-SHA256 over the
**encoded** payload with the app secret; payload `algorithm` must be `HMAC-SHA256`,
`issued_at` within the last day (and at most 5 minutes ahead), `expires` a non-negative
integer if present. Both base64url parts must be canonical (no padding, no `+`/`/`). A
body over 8 KB is a `413`; anything else wrong is a `400`. Nothing to delete (nothing is
stored per user); respond `200`. **Unverified:** whether Instagram-Login apps sign these with the Instagram app
secret or the Meta app secret; test with Meta's dashboard tools.

## Logging

Workers Logs (free plan: 3 days' retention) with **automatic invocation logs off**
(`observability.logs.invocation_logs: false`) and tracing off (subrequest URLs carry
`client_secret` and tokens). The Worker logs instead, through one function in
`src/log.ts`, as structured JSON (`console.log({ … })`), so Workers Logs can filter on
fields:

- **One line per request:** method, the **route template** (e.g.
  `PUT /uploads/:id/:i.jpg`, never the raw path), status, duration, Cloudflare location
  (`request.cf.colo`), and the outcome (`ok`, or an error code like `bad_signature`,
  `expired`, `not_jpeg`, `too_large`, `exists`, `enrollment_mismatch`).
- **Correlation without secrets:** `batch` = the first 8 hex characters of
  SHA-256(`id`), so an upload's POST, PUTs, GETs (Instagram's fetches), DELETE, and its
  sweep can be followed without logging the id (which is what grants access to the
  frames). Likewise `user` = a short **keyed** hash (HMAC with an HKDF label
  `sequence/v1/log`; user ids are public, so a plain hash could be checked against a
  known account) of the Instagram `user_id` for auth and upload requests, and the frame
  index `i`.
- **Query parameters by name only:** e.g. `query: ["exp", "sig"]`, values never logged.
- **Instagram failures:** the endpoint called (route only, no query), HTTP status, and
  Instagram's `error.code`, `error.error_subcode`, `error.type`, and `fbtrace_id` (Meta's
  id for the request, for their support). Not `error.message` (it can echo input).
- **Sizes and frames:** body length, and for frames the parsed width × height.
- **Sweep runs:** objects listed, deleted, pages.
- **Never logged:** tokens, `code`, `state`, `sig`, `verifier`, sealed values,
  enrollments, `client_secret`, `signed_request`, raw URLs or query strings, request or
  response bodies, headers (`Authorization`), image bytes, usernames.

Redaction is by **allowlist**: `log()` accepts a typed record of known fields only (no
free-form strings from requests), so a new field can't leak by accident. Uncaught
exceptions are caught at the router and logged as the error's name and the route, not
its message (messages can contain URLs). A test fails if any log line contains a
query string, a 22-character id, or known secret values used in the test.

`wrangler tail` (live, owner-only) shows these same lines; with invocation logs off it
doesn't add raw request URLs.

## Abuse and rate limits

- Uploads need an enrollment + matching token (above), so the server isn't a public
  image host.
- Per batch: at most `MAX_FRAMES` write-once frames of ≤ 8 MB, for ≤ 30 minutes.
- Workers Rate Limiting binding (confirm it's on the free plan) as a speed bump, not a
  quota (periods are 10 or 60 seconds only; counters are per location and approximate):
  `/uploads` at ~3 per 60 s per Instagram `user_id` (`UPLOAD_RATE_LIMIT`, keyed by the
  keyed user hash); `/auth/*` and `/meta/*` at ~10 per 60 s per IP (`IP_RATE_LIMIT`,
  keys `auth:<ip>` and `meta:<ip>` from `CF-Connecting-IP`). Over the limit: `429`. It
  fails open: a missing binding or a failing `limit()` call lets the request through
  (the latter logged as an exception).
- Past the Workers free tier, requests fail rather than bill; the remaining cost
  exposure is R2 operations and storage, bounded by the above.

## CORS

For `/auth/redeem`, `/auth/renew`, and `/uploads*` only: allow origins from env
`ALLOWED_ORIGINS` (`https://sequence.photos`; `http://localhost:5175` only in the `dev`
environment; the Mac app's origin later). Allow `Authorization`, `Content-Type`; methods
`POST, PUT, DELETE`. Origins aren't a security boundary (non-browsers can send
anything); the enrollment and token checks are.

## Shared API types (`src/api.ts`)

Dependency-free so the app can vendor a copy (later: a package):

```ts
export interface InstagramConnection {
  /** Instagram long-lived token. */
  token: string;
  /** Unix seconds: when the token expires, and when it was issued or last refreshed. */
  expiresAt: number;
  refreshedAt: number;
  /** The professional account's id (from /me), used for publishing. */
  userId: string;
  username: string;
  /** Sequence's enrollment credential (see Enrollment). */
  enrollment: string;
}

export interface UploadBatch {
  id: string;
  frames: { put: string; url: string }[];
  delete: string;
}

export type InstagramError = 'cancelled' | 'exchange_failed' | 'missing_permission' | 'not_professional';
```

(No profile picture: its CDN URL expires. No account type: non-professional accounts
are rejected at sign-in.)

## The app's side (in the app repo, after the server works)

- **Content Security Policy first (blocks shipping this):** the website stores a
  refreshable publishing token, so add a strict CSP for `/app/*` in `netlify.toml`
  `[[headers]]`: `script-src 'self'`, `connect-src 'self' https://graph.instagram.com
  <server origin>`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`
  (plus what the app already needs, e.g. `img-src` for `blob:`/`data:`). Consider Trusted
  Types.
- **Settings → Instagram:** "Connect Instagram" starts sign-in (above; web: same tab;
  Mac: system browser and a link back, later). Connected: shows `@username` and
  "Disconnect", which forgets everything stored and says that to fully revoke access,
  remove Sequence in Instagram's settings (forgetting locally doesn't revoke the token).
  `not_professional`: explain that posting needs a Business or Creator account.
- **Storing the connection:** web: `localStorage` (hence the CSP). Mac: the Keychain
  (later).
- **File → Post to Instagram…** (digital projects, when connected): a dialog with the
  caption, feed or story, and a preview. Checks before uploading:
  - Feed: 1 frame (single image) or 2–10 (carousel; the API's limit, though the
    Instagram app allows 20); aspect ratio within 4:5 to 1.91:1 (documented, so the
    default 3:4 can't post to the feed; see Open questions).
  - Story: frames post one by one.
  - Each JPEG: scaled to at most 1440 px wide, ≤ 8 MB (lower the quality if needed).
- **Posting** (all with `access_token=<token>`, against
  `https://graph.instagram.com/<version>`):
  1. If the token is past `expiresAt`: reconnect. If it's at least 24 hours old (by
     `refreshedAt`; Instagram refuses younger ones) and more than ~30 days old:
     `GET /refresh_access_token?grant_type=ig_refresh_token` (no secret needed), then
     `POST /auth/renew`; save both.
  2. `GET /<userId>/content_publishing_limit` (show a message if the limit is reached).
  3. `POST /uploads` to our server, then `PUT` each frame.
  4. Containers: `POST /<userId>/media` with `image_url` (and `is_carousel_item=true`
     for carousels; `media_type=STORIES` for stories); then for a carousel,
     `POST /<userId>/media` with `media_type=CAROUSEL&children=<ids>&caption=…`.
  5. Poll `GET /<containerId>?fields=status_code` until `FINISHED`: start after a few
     seconds and back off toward Meta's guidance (about once a minute, at most 5
     minutes). `ERROR`/`EXPIRED` → explain.
  6. `POST /<userId>/media_publish` with `creation_id`.
  7. `DELETE` the upload batch, only after publishing succeeds or the post is abandoned
     (in a `finally`).
  8. Show the post: `GET /<mediaId>?fields=permalink`.
- **Privacy policy** (`privacy/index.html` in the app repo) and the App Store privacy
  answers: when you post to Instagram, the frames are uploaded to Sequence's server for
  Instagram to fetch, and deleted after posting (automatically within about an hour and
  a half otherwise); your Instagram token stays on your device.

## Repo layout

```
src/
  index.ts        router: fetch + scheduled handlers
  env.ts          Env type (bindings, vars, secrets)
  api.ts          shared request/response types
  keys.ts         HKDF key derivation, sign/verify, seal/unseal
  auth.ts         /auth/callback, /auth/redeem, /auth/renew
  uploads.ts      /uploads, PUT, DELETE
  jpeg.ts         JPEG structure and dimension checks
  frames.ts       GET /frames
  sweep.ts        scheduled cleanup
  meta.ts         Meta callbacks, signed_request verification
  instagram.ts    typed Instagram calls + response guards
  http.ts         CORS, errors, headers, input validation
  log.ts          the one logging function (allowlisted fields, hashing)
test/             vitest with @cloudflare/vitest-plugin (formerly vitest-pool-workers;
                  R2 in-process, Instagram faked with a fetch spy)
wrangler.jsonc
```

`wrangler.jsonc`:

- `name`, `main`, `compatibility_date`.
- R2 binding `FRAMES` (bucket `sequence-frames`).
- Cron `*/15 * * * *`.
- `"observability": { "enabled": true, "logs": { "enabled": true, "invocation_logs": false } }`,
  no tracing (see Logging).
- Rate limit bindings (see Abuse).
- Vars: `IG_APP_ID`, `GRAPH_VERSION` (pin the current version at implementation time),
  `CALLBACK_URL`, `RETURN_URLS`, `ALLOWED_ORIGINS`, `MAX_FRAMES` (`10`).
- An `env.dev` block with its own name, R2 bucket, `RETURN_URLS`/`ALLOWED_ORIGINS`
  including `localhost`, and its own secrets.

## Setup (by the owner; can't be done by a coding session)

1. **Cloudflare:** an account; enable R2 (needs a payment method on file);
   `wrangler login`.
2. **Meta:** at developers.facebook.com, create an app (Business type) and add the
   Instagram product, _API setup with Instagram business login_. Note the Instagram App
   ID and secret. Add the Worker's `/auth/callback` URL as the OAuth redirect URI. Add
   your Instagram professional account as an **Instagram tester** (and accept the
   invite in Instagram). Only testers can connect until App Review grants Advanced
   Access for `instagram_business_content_publish`. Ideally a second Meta app for `dev`.
3. `wrangler secret put IG_APP_SECRET` and `wrangler secret put SERVER_SECRET` (and the
   same for `--env dev`).
4. `wrangler r2 bucket create sequence-frames` (and the dev bucket), plus the 1-day
   lifecycle rule.
5. Fill in the placeholder vars in `wrangler.jsonc` (`IG_APP_ID`, `CALLBACK_URL`, for
   both environments), then `npm run types`.
6. After the first deploy, on the real R2 bucket: upload a frame, then `PUT` the same
   signed URL again and check it returns `409` and the first image is unchanged (that R2
   honours the conditional put). Check that the rate-limit bindings work on the free
   plan (an 11th `/auth/redeem` from one IP within a minute should get `429`).
7. Later, for App Review: privacy policy URL, the Meta callback URLs above, a screencast
   of connecting and posting.

## Testing

- Unit: HKDF derivation; sign/verify (expiry in the past and too far in the future,
  tampering, wrong purpose, wrong method or index); seal/unseal (tampering, expiry, wrong
  verifier); `signed_request` parsing; JPEG structure and dimension checks (truncated,
  polyglot, oversize, wrong dimensions); input formats (`id`, `i`, `state`); response
  guards for Instagram JSON.
- Worker (`@cloudflare/vitest-plugin`): callback happy path and every error path (mocked
  Instagram), including unknown client (`400`, no redirect) and non-professional
  accounts; redeem with right and wrong verifiers; renew with matching and mismatched
  users; upload batch → PUT → GET → DELETE; a second PUT to the same frame (`409`);
  expired and bad signatures; GET of a frame over an hour old; the sweep with more than
  one page; log lines for each route carry the route template, status, and `batch`
  hash, and never a query string, id, or any secret used in the test.
- End to end, by hand, with a tester account once Meta is set up: connect, post a
  single image, a carousel, a story. Also check a 3:4 frame to settle the open question.

## Development

Node 22+ and npm. Nothing here touches a Cloudflare or Meta account.

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in IG_APP_SECRET and SERVER_SECRET
npm run dev                      # wrangler dev --env dev: local Worker, local R2
```

`npm run dev` runs the `dev` environment locally, on <http://localhost:8787>, with a
local R2 bucket (under `.wrangler/`) and simulated rate limits. Secrets come from
`.dev.vars` (never committed); `SERVER_SECRET` must be at least 43 characters, e.g.
`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. Signing in for real needs the dev
Meta app's secret, and the dev Meta app's redirect URI set to the `CALLBACK_URL` in use.

| Command | What it does |
| --- | --- |
| `npm test` | vitest, inside workerd (`@cloudflare/vitest-plugin`), with a local R2 bucket and Instagram faked |
| `npm run typecheck` | checks `worker-configuration.d.ts` is current, then `tsc` |
| `npm run lint` | typescript-eslint, strict and type-aware; no `any`, unsafe access, non-null assertions, or `as` |
| `npm run format` / `format:check` | prettier |
| `npm run types` | regenerates `worker-configuration.d.ts` (the `Env` type) from `wrangler.jsonc`; run after any change to it |

Tests use fixed secrets and high rate limits from `vitest.config.ts`, not `.dev.vars`.
They print a harmless "Missing required secrets" warning. Locally, `wrangler dev` prints
its own line per request with the raw path; deployed, with invocation logs off, only the
Worker's redacted lines are recorded.

## Out of scope (for now)

Scheduling, video and reels, saved drafts, analytics, multiple accounts, any database,
a custom domain, the Mac app's sign-in (Universal Link or deep link) and Keychain
storage.

## Open questions

- **3:4 frames:** the API reference requires feed images within 4:5 to 1.91:1; the
  app's default is 3:4 (1080 × 1440). Confirm with the real API; then change the default
  to 4:5, trim when posting, or explain.
- **Carousel limit:** the API reference says carousels take up to 10 items, though the
  Instagram app has allowed 20 since 2024 and scheduling tools (e.g. Later) report the
  API still caps them at 10. Test a 20-item carousel with a tester account; if it posts,
  raise `MAX_FRAMES` to 20 (the server's index check and the app's check follow it).
  Until then, sequences longer than the limit: refuse, or offer to post the first ten.
- **Publishing limit:** Meta's docs say both 100 and 50 posts per 24 hours in different
  places; read `content_publishing_limit` rather than assuming.
- **Unverified:** which secret signs Meta's callbacks for Instagram-Login apps (the
  Worker verifies with `IG_APP_SECRET`; if Meta uses the Meta app's secret, add it as a
  separate secret and verify with that); the
  Workers free plan's request body limit (believed 100 MB; we need ≤ 8 MB) and Rate
  Limiting availability.
