// Typed calls to Instagram (Instagram API with Instagram Login), with response guards.
//
// URLs here carry `client_secret`, codes, and tokens: they're never logged. A failed call
// logs one `instagram` line with the endpoint, status, and Instagram's error code, subcode,
// type, and fbtrace_id (never its message, which can echo input).

import * as v from 'valibot';
import type { Config } from './env';
import { isUserId } from './keys';
import { log, type InstagramEndpoint } from './log';

const OAUTH_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_ORIGIN = 'https://graph.instagram.com';
const TIMEOUT_MS = 10_000;
/** Instagram's responses are small; anything bigger is not what we asked for. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export const PUBLISH_PERMISSION = 'instagram_business_content_publish';

/**
 * `unavailable`: no answer, a timeout, or a 5xx (worth retrying later).
 * `rejected`: Instagram said no (4xx), or answered with something we can't parse.
 */
export type Failure = 'unavailable' | 'rejected';
export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

// --- Guards -----------------------------------------------------------------------------

const Token = v.pipe(v.string(), v.minLength(1), v.maxLength(2048));
/** Ids arrive as strings, but accept a number that's still exact. */
const UserIdField = v.union([
  v.pipe(v.string(), v.check(isUserId)),
  v.pipe(
    v.number(),
    v.safeInteger(),
    v.minValue(0),
    v.transform((n) => String(n)),
  ),
]);
/** Granted permissions: documented as an array, seen as a comma-separated string. */
const Permissions = v.union([
  v.array(v.string()),
  v.pipe(
    v.string(),
    v.transform((s) =>
      s
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== ''),
    ),
  ),
]);

const ShortLivedToken = v.object({
  access_token: Token,
  user_id: v.optional(UserIdField),
  permissions: v.optional(Permissions),
});
/** Documented as `{ data: [ … ] }`; older docs show the object itself. Accept both. */
const CodeExchangeResponse = v.union([
  v.object({ data: v.pipe(v.array(ShortLivedToken), v.minLength(1)) }),
  ShortLivedToken,
]);

const LongLivedTokenResponse = v.object({
  access_token: Token,
  expires_in: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});

const MeResponse = v.object({
  user_id: UserIdField,
  username: v.optional(v.string()),
  account_type: v.optional(v.string()),
});

/** Graph errors (`{ error: { … } }`) and OAuth errors (`{ error_type, code, … }`). */
const ErrorResponse = v.object({
  error: v.optional(
    v.object({
      code: v.optional(v.number()),
      error_subcode: v.optional(v.number()),
      type: v.optional(v.string()),
      fbtrace_id: v.optional(v.string()),
    }),
  ),
  code: v.optional(v.number()),
  error_type: v.optional(v.string()),
});

// --- Calls ------------------------------------------------------------------------------

/**
 * Instagram sends some ids as bare JSON numbers, and they're longer than a JavaScript
 * number holds exactly (about 17 digits), so they're quoted before parsing to keep every
 * digit.
 */
export function quoteIds(text: string): string {
  return text.replace(/("(?:user_id|id)"\s*:\s*)(\d+)/g, '$1"$2"');
}

/** The schema fields a response failed on, by name (never values), for the log. */
function failedFields(issues: readonly v.BaseIssue<unknown>[]): string {
  const names = issues.map((i) => i.path?.map((p) => String(p.key)).join('.') ?? '(root)');
  return [...new Set(names)].join(',');
}

/** Makes the call and parses the response; logs and classifies any failure. */
async function call<S extends v.GenericSchema>(
  endpoint: InstagramEndpoint,
  url: string,
  init: RequestInit,
  schema: S,
): Promise<Result<v.InferOutput<S>>> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    text = await response.text();
  } catch {
    // Network error or timeout. Status 0: no response.
    log({ event: 'instagram', endpoint, status: 0 });
    return { ok: false, failure: 'unavailable' };
  }

  let json: unknown = undefined;
  if (text.length <= MAX_RESPONSE_BYTES) {
    try {
      json = JSON.parse(quoteIds(text));
    } catch {
      // Left undefined: fails the schema below.
    }
  }

  let fields: string | undefined;
  if (response.ok) {
    const parsed = v.safeParse(schema, json);
    if (parsed.success) return { ok: true, value: parsed.output };
    fields = json === undefined ? '(not json)' : failedFields(parsed.issues);
  }

  const error = v.safeParse(ErrorResponse, json);
  const detail = error.success ? error.output : undefined;
  const code = detail?.error?.code ?? detail?.code;
  const subcode = detail?.error?.error_subcode;
  const type = detail?.error?.type ?? detail?.error_type;
  const fbtraceId = detail?.error?.fbtrace_id;
  log({
    event: 'instagram',
    endpoint,
    status: response.status,
    ...(code === undefined ? {} : { code }),
    ...(subcode === undefined ? {} : { subcode }),
    ...(type === undefined ? {} : { type }),
    ...(fbtraceId === undefined ? {} : { fbtraceId }),
    ...(fields === undefined ? {} : { fields }),
  });
  return { ok: false, failure: response.status >= 500 ? 'unavailable' : 'rejected' };
}

export interface ShortLived {
  token: string;
  permissions: readonly string[];
}

/** Exchanges an authorization code for a short-lived token (needs the app secret). */
export async function exchangeCode(
  config: Config,
  appSecret: string,
  code: string,
): Promise<Result<ShortLived>> {
  const body = new URLSearchParams({
    client_id: config.igAppId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.callbackUrl,
    code,
  });
  const result = await call(
    'POST api.instagram.com/oauth/access_token',
    OAUTH_TOKEN_URL,
    { method: 'POST', body },
    CodeExchangeResponse,
  );
  if (!result.ok) return result;
  const first = 'data' in result.value ? result.value.data[0] : result.value;
  if (!first) return { ok: false, failure: 'rejected' };
  return {
    ok: true,
    value: { token: first.access_token, permissions: first.permissions ?? [] },
  };
}

export interface LongLived {
  token: string;
  /** Seconds. */
  expiresIn: number;
}

/** Exchanges a short-lived token for a long-lived one (~60 days). */
export async function exchangeLongLived(
  appSecret: string,
  shortLivedToken: string,
): Promise<Result<LongLived>> {
  const url = new URL('/access_token', GRAPH_ORIGIN);
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('access_token', shortLivedToken);
  const result = await call(
    'GET graph.instagram.com/access_token',
    url.toString(),
    {},
    LongLivedTokenResponse,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: { token: result.value.access_token, expiresIn: result.value.expires_in },
  };
}

export interface Me {
  userId: string;
  username?: string;
  accountType?: string;
}

/** `GET /me` with the given fields (`user_id` is always included). */
export async function getMe(
  config: Config,
  token: string,
  fields: readonly ('username' | 'account_type')[] = [],
): Promise<Result<Me>> {
  const url = new URL(`/${config.graphVersion}/me`, GRAPH_ORIGIN);
  url.searchParams.set('fields', ['user_id', ...fields].join(','));
  url.searchParams.set('access_token', token);
  const result = await call('GET graph.instagram.com/me', url.toString(), {}, MeResponse);
  if (!result.ok) return result;
  const { user_id, username, account_type } = result.value;
  return {
    ok: true,
    value: {
      userId: user_id,
      ...(username === undefined ? {} : { username }),
      ...(account_type === undefined ? {} : { accountType: account_type }),
    },
  };
}

/**
 * Whether an account type can publish: Business or Creator. Instagram spells these
 * `BUSINESS` and `MEDIA_CREATOR`; compared case-insensitively. Missing or anything
 * else (e.g. `PERSONAL`) counts as not professional.
 */
export function isProfessional(accountType: string | undefined): boolean {
  const type = accountType?.toUpperCase();
  return type === 'BUSINESS' || type === 'MEDIA_CREATOR' || type === 'CREATOR';
}
