// Routing, errors, default headers, CORS, and input validation.

import * as v from 'valibot';
import { getConfig, type Config } from './env';
import { decodeUtf8, getKeys, type Keys } from './keys';
import {
  errorName,
  log,
  Tag,
  METHODS,
  queryNames,
  type Method,
  type Outcome,
  type RequestLine,
  type Route,
} from './log';

// --- Errors and responses ---------------------------------------------------------------

/** Thrown by handlers; the router turns it into a plain-text response with no detail. */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly outcome: Outcome,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(outcome);
  }
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  411: 'Length Required',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
};

export function textResponse(
  status: number,
  body?: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const response = new Response(body ?? STATUS_TEXT[status] ?? '', { status, headers });
  response.headers.set('Content-Type', 'text/plain; charset=utf-8');
  return response;
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Headers on every response (handlers may add more, e.g. for frames). */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

// --- Routing ----------------------------------------------------------------------------

/** What a handler gets. `log` is filled in by the handler and written by the router. */
export interface RequestContext {
  request: Request;
  url: URL;
  env: Env;
  config: Config;
  keys: Keys;
  /** Unix seconds. */
  now: number;
  /** Named groups from the route's path pattern (raw strings: validate before use). */
  params: Readonly<Partial<Record<string, string>>>;
  log: LogFields;
  waitUntil(promise: Promise<unknown>): void;
  /**
   * Applies a rate limit (README "Abuse and rate limits"); throws 429 when over it.
   * `ip` keys on the client's IP; `user` on an Instagram user id.
   */
  rateLimit(scope: RateLimitScope): Promise<void>;
}

export type RateLimitScope =
  { kind: 'ip'; group: 'auth' | 'meta' } | { kind: 'user'; userId: string };

export type LogFields = {
  -readonly [
    K in 'outcome' | 'batch' | 'user' | 'i' | 'bytes' | 'width' | 'height'
  ]?: RequestLine[K];
};

export type Handler = (ctx: RequestContext) => Promise<Response>;

export interface RouteDef {
  method: Exclude<Method, 'OPTIONS'>;
  /** Anchored, with named groups for parameters. */
  path: RegExp;
  route: Route;
  /** Whether browsers may call this route cross-origin (from `ALLOWED_ORIGINS`). */
  cors: boolean;
  /** For the CORS preflight on this path. */
  preflightRoute?: Route;
  handler: Handler;
}

// --- Rate limits ------------------------------------------------------------------------

function isRateLimit(value: unknown): value is RateLimit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'limit' in value &&
    typeof value.limit === 'function'
  );
}

/**
 * A speed bump, not a quota (README "Abuse and rate limits"). Keys: `auth:<ip>` and
 * `meta:<ip>` on IP_RATE_LIMIT; `user:<keyed user hash>` on UPLOAD_RATE_LIMIT, so the
 * raw user id never leaves the Worker. Fails open: a missing binding, a request without
 * `CF-Connecting-IP` (only seen locally), or a throwing `limit()` lets the request
 * through (the last one logged as an exception). Over the limit → 429.
 */
async function applyRateLimit(
  scope: RateLimitScope,
  request: Request,
  env: Env,
  keys: Keys,
  route: Route,
): Promise<void> {
  const binding: unknown = scope.kind === 'user' ? env.UPLOAD_RATE_LIMIT : env.IP_RATE_LIMIT;
  if (!isRateLimit(binding)) return;

  let key: string;
  if (scope.kind === 'user') {
    key = `user:${(await Tag.user(keys.log, scope.userId)).hex}`;
  } else {
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip === null || ip === '') return;
    key = `${scope.group}:${ip}`;
  }

  let success: boolean;
  try {
    ({ success } = await binding.limit({ key }));
  } catch (error) {
    log({ event: 'exception', route, name: errorName(error) });
    return;
  }
  if (!success) throw new HttpError(429, 'rate_limited');
}

function toMethod(method: string): Method | 'other' {
  return METHODS.find((m) => m === method) ?? 'other';
}

function addCorsHeaders(response: Response, origin: string | null, config: Config): void {
  response.headers.append('Vary', 'Origin');
  if (origin !== null && config.allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
}

function preflight(request: Request, config: Config): Response {
  const origin = request.headers.get('Origin');
  if (origin === null || !config.allowedOrigins.has(origin)) {
    throw new HttpError(403, 'bad_request');
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    },
  });
}

/** A mutable copy of `response` (fetch responses and `Response.redirect` are immutable). */
function mutable(response: Response): Response {
  return new Response(response.body, response);
}

/**
 * Handles one request: matches a route, runs its handler, maps errors to responses, adds
 * default and CORS headers, and writes the request's log line.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  routes: readonly RouteDef[],
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const method = toMethod(request.method);
  const fields: LogFields = {};
  let route: Route = 'unmatched';
  let cors = false;
  let response: Response;

  try {
    const config = getConfig(env);
    const onPath = routes
      .map((def) => ({ def, match: def.path.exec(url.pathname) }))
      .filter((m) => m.match !== null);
    const found = onPath.find((m) => m.def.method === method);

    if (method === 'OPTIONS' && onPath[0]?.def.cors === true && onPath[0].def.preflightRoute) {
      route = onPath[0].def.preflightRoute;
      cors = true;
      response = preflight(request, config);
    } else if (found) {
      const matchedRoute = found.def.route;
      route = matchedRoute;
      cors = found.def.cors;
      const keys = await getKeys(env.SERVER_SECRET);
      response = await found.def.handler({
        request,
        url,
        env,
        config,
        keys,
        now: Math.floor(Date.now() / 1000),
        params: found.match?.groups ?? {},
        log: fields,
        waitUntil: (promise) => {
          ctx.waitUntil(promise);
        },
        rateLimit: (scope) => applyRateLimit(scope, request, env, keys, matchedRoute),
      });
    } else if (onPath.length > 0) {
      const allow = [...new Set(onPath.map((m) => m.def.method))].join(', ');
      throw new HttpError(405, 'method_not_allowed', { Allow: allow });
    } else {
      throw new HttpError(404, 'not_found');
    }
  } catch (error) {
    if (error instanceof HttpError) {
      fields.outcome = error.outcome;
      response = textResponse(error.status, undefined, error.headers);
    } else {
      // The name only: messages can contain URLs.
      log({ event: 'exception', route, name: errorName(error) });
      fields.outcome = 'internal_error';
      response = textResponse(500);
    }
  }

  response = mutable(response);
  for (const [name, value] of Object.entries(DEFAULT_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  if (cors) {
    try {
      addCorsHeaders(response, request.headers.get('Origin'), getConfig(env));
    } catch {
      // Config errors were already reported above.
    }
  }

  const query = queryNames(url);
  log({
    event: 'request',
    method,
    route,
    status: response.status,
    ms: Date.now() - started,
    ...(typeof request.cf?.colo === 'string' ? { colo: request.cf.colo } : {}),
    ...(query.length > 0 ? { query } : {}),
    ...fields,
    outcome: fields.outcome ?? (response.status < 400 ? 'ok' : 'internal_error'),
  });
  return response;
}

// --- Input validation -------------------------------------------------------------------

/** An upload batch id: 128 random bits as base64url, exactly 22 characters. */
export function isBatchId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9_-]{22}$/.test(value);
}

/** A frame index: decimal, no leading zeros, below `maxFrames`. Null if invalid. */
export function parseFrameIndex(value: string | undefined, maxFrames: number): number | null {
  if (value === undefined || !/^(0|[1-9][0-9]?)$/.test(value)) return null;
  const index = Number(value);
  return index < maxFrames ? index : null;
}

/** Unix seconds from a query parameter. Null if absent or malformed. */
export function parseExp(value: string | null): number | null {
  return value !== null && /^[1-9][0-9]{0,11}$/.test(value) ? Number(value) : null;
}

/** A 32-byte value as base64url (nonce, PKCE challenge, verifier). */
export function isBase64Url32(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface OAuthState {
  client: string;
  nonce: string;
  challenge: string;
}

/** `<client>.<nonce>.<challenge>`. Null if malformed (the client isn't checked here). */
export function parseState(value: string | null): OAuthState | null {
  if (value === null || value.length > 200) return null;
  const parts = value.split('.');
  const [client, nonce, challenge] = parts;
  if (
    parts.length !== 3 ||
    client === undefined ||
    nonce === undefined ||
    challenge === undefined
  ) {
    return null;
  }
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(client)) return null;
  if (!isBase64Url32(nonce) || !isBase64Url32(challenge)) return null;
  return { client, nonce, challenge };
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function parseBearer(header: string | null): string | null {
  if (header === null || header.length > 2100) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]{1,2048}=*)$/.exec(header);
  return match?.[1] ?? null;
}

/** `Content-Length` as a number; null if absent; throws 400 if malformed. */
export function contentLength(request: Request): number | null {
  const header = request.headers.get('Content-Length');
  if (header === null) return null;
  if (!/^(0|[1-9][0-9]{0,14})$/.test(header)) throw new HttpError(400, 'bad_request');
  return Number(header);
}

/**
 * Reads the body, at most `max` bytes: rejects early on a larger `Content-Length`, and
 * stops reading (413) if a body without one runs over.
 */
export async function readBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = contentLength(request);
  if (declared !== null && declared > max) throw new HttpError(413, 'too_large');
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // The runtime's stream types are loose (`any` chunks); check what arrives.
    const result: ReadableStreamReadResult<unknown> = await reader.read();
    if (result.done) break;
    const chunk = result.value;
    if (!(chunk instanceof Uint8Array)) throw new HttpError(400, 'bad_request');
    total += chunk.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, 'too_large');
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Reads a JSON body of at most `max` bytes and parses it with `schema`; else 400. */
export async function readJson<S extends v.GenericSchema>(
  request: Request,
  max: number,
  schema: S,
): Promise<v.InferOutput<S>> {
  const text = decodeUtf8(await readBody(request, max));
  if (text === null) throw new HttpError(400, 'bad_request');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_request');
  }
  const parsed = v.safeParse(schema, json);
  if (!parsed.success) throw new HttpError(400, 'bad_request');
  return parsed.output;
}
