// Routing: matches a request to a handler, maps errors to responses, and adds default and
// CORS headers. Writes the request's log line.

import { getConfig, type Config } from './env';
import { HttpError } from './http';
import { getKeys, type Keys } from './keys';
import {
  errorName,
  log,
  METHODS,
  queryNames,
  type Method,
  type RequestLine,
  type Route,
} from './log';
import { applyRateLimit, type RateLimitScope } from './ratelimit';

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
  /**
   * Applies a rate limit (README "Abuse and rate limits"); throws 429 when over it.
   * `ip` keys on the client's IP; `user` on an Instagram user id.
   */
  rateLimit(scope: RateLimitScope): Promise<void>;
}

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
  /**
   * For routes browsers may call cross-origin (from `ALLOWED_ORIGINS`): the route of the
   * CORS preflight on this path. Without it, the route has no CORS.
   */
  preflight?: Route;
  handler: Handler;
}

// --- Responses --------------------------------------------------------------------------

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

/** A plain-text error response: the status text, no detail. */
function textResponse(status: number, headers: Readonly<Record<string, string>> = {}): Response {
  const response = new Response(STATUS_TEXT[status] ?? '', { status, headers });
  response.headers.set('Content-Type', 'text/plain; charset=utf-8');
  return response;
}

/** Headers on every response (handlers may add more, e.g. for frames). */
const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/** A mutable copy of `response` (fetch responses and `Response.redirect` are immutable). */
function mutable(response: Response): Response {
  return new Response(response.body, response);
}

// --- CORS -------------------------------------------------------------------------------

function addCorsHeaders(response: Response, origin: string | null, config: Config): void {
  response.headers.append('Vary', 'Origin');
  if (origin !== null && config.allowedOrigins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
}

function preflight(request: Request, config: Config): Response {
  const origin = request.headers.get('Origin');
  if (origin === null || !config.allowedOrigins.has(origin)) {
    throw new HttpError(403, 'forbidden_origin');
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

// --- Routing ----------------------------------------------------------------------------

function toMethod(method: string): Method | 'other' {
  return METHODS.find((m) => m === method) ?? 'other';
}

/**
 * Handles one request: matches a route, runs its handler, maps errors to responses, adds
 * default and CORS headers, and writes the request's log line.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  routes: readonly RouteDef[],
): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const method = toMethod(request.method);
  const fields: LogFields = {};
  let route: Route = 'unmatched';
  let cors = false;
  let config: Config | undefined;
  let response: Response;

  try {
    config = getConfig(env);
    const onPath = routes
      .map((def) => ({ def, match: def.path.exec(url.pathname) }))
      .filter((m) => m.match !== null);
    const found = onPath.find((m) => m.def.method === method);
    const preflightRoute = onPath[0]?.def.preflight;

    if (method === 'OPTIONS' && preflightRoute !== undefined) {
      route = preflightRoute;
      cors = true;
      response = preflight(request, config);
    } else if (found) {
      const matchedRoute = found.def.route;
      route = matchedRoute;
      cors = found.def.preflight !== undefined;
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
      response = textResponse(error.status, error.headers);
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
  // Without a config (it failed to parse, reported above), there's no CORS to add.
  if (cors && config) addCorsHeaders(response, request.headers.get('Origin'), config);

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
