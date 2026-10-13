// The one logging function. See README "Logging".
//
// Redaction is by allowlist: `log()` copies only known fields, each checked against a
// fixed set of values or a tight pattern, so nothing from a request (or a new field added
// by mistake) reaches the logs. Values that would identify a batch or a user are logged
// as short hashes (`Tag`s), which only this module can make.

import { utf8 } from './encoding';

/** A short, non-reversible hash for correlating log lines. */
export class Tag {
  private constructor(readonly hex: string) {}

  /** First 8 hex characters of SHA-256(id): for batch ids (128 random bits). */
  static async batch(id: string): Promise<Tag> {
    return new Tag(hex8(await crypto.subtle.digest('SHA-256', utf8(id))));
  }

  /**
   * First 8 hex characters of HMAC(log key, userId). Keyed, unlike the batch hash:
   * Instagram user ids are public and enumerable, so a plain hash would let anyone with
   * the logs check whether a given account used Sequence.
   */
  static async user(logKey: CryptoKey, userId: string): Promise<Tag> {
    return new Tag(hex8(await crypto.subtle.sign('HMAC', logKey, utf8(userId))));
  }
}

function hex8(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest).subarray(0, 4), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'] as const;
export type Method = (typeof METHODS)[number];

export const ROUTES = [
  'GET /auth/callback',
  'POST /auth/redeem',
  'POST /auth/renew',
  'POST /uploads',
  'PUT /uploads/:id/:i.jpg',
  'DELETE /uploads/:id',
  'GET /frames/:id/:i.jpg',
  'HEAD /frames/:id/:i.jpg',
  'POST /meta/deauthorize',
  'POST /meta/data-deletion',
  'GET /meta/deletion',
  'OPTIONS /auth/redeem',
  'OPTIONS /auth/renew',
  'OPTIONS /uploads',
  'OPTIONS /uploads/:id/:i.jpg',
  'OPTIONS /uploads/:id',
  'unmatched',
] as const;
export type Route = (typeof ROUTES)[number];

export const OUTCOMES = [
  'ok',
  'bad_request',
  'forbidden_origin',
  'bad_state',
  'unknown_client',
  'bad_signature',
  'expired',
  'not_jpeg',
  'too_large',
  'length_required',
  'exists',
  'not_found',
  'method_not_allowed',
  'unauthorized',
  'enrollment_mismatch',
  'rate_limited',
  'cancelled',
  'exchange_failed',
  'missing_permission',
  'not_professional',
  'instagram_unavailable',
  'internal_error',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Query parameter names worth seeing in logs. Any other name is logged as `other`. */
export const QUERY_NAMES = [
  'code',
  'state',
  'error',
  'error_reason',
  'error_description',
  'exp',
  'sig',
  'other',
] as const;
export type QueryName = (typeof QUERY_NAMES)[number];

export const INSTAGRAM_ENDPOINTS = [
  'POST api.instagram.com/oauth/access_token',
  'GET graph.instagram.com/access_token',
  'GET graph.instagram.com/me',
] as const;
export type InstagramEndpoint = (typeof INSTAGRAM_ENDPOINTS)[number];

/** Error names logged as themselves; anything else is logged as `Error`. */
const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AbortError',
  'TimeoutError',
  'OperationError',
  'DataError',
  'NotSupportedError',
  'InvalidStateError',
]);

export interface RequestLine {
  event: 'request';
  method: Method | 'other';
  route: Route;
  status: number;
  /** Milliseconds. */
  ms: number;
  /** Cloudflare location (`request.cf.colo`). */
  colo?: string;
  outcome: Outcome;
  batch?: Tag;
  user?: Tag;
  /** Frame index. */
  i?: number;
  /** Names only, never values. */
  query?: readonly QueryName[];
  /** Request body length in bytes. */
  bytes?: number;
  width?: number;
  height?: number;
}

export interface InstagramLine {
  event: 'instagram';
  endpoint: InstagramEndpoint;
  status: number;
  /** Instagram's `error.code`, `error.error_subcode`, `error.type`, and `fbtrace_id`. */
  code?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
  /** A 2xx response that didn't match its schema: the failing fields' names, never values. */
  fields?: string;
}

export interface SweepLine {
  event: 'sweep';
  listed: number;
  deleted: number;
  pages: number;
  ms: number;
}

export interface ExceptionLine {
  event: 'exception';
  route: Route | 'scheduled';
  /** The error's name only: messages can contain URLs. */
  name: string;
}

export type LogLine = RequestLine | InstagramLine | SweepLine | ExceptionLine;

/** A log record as written: only these primitive fields, nothing nested from requests. */
export type LogRecord = Record<string, string | number | readonly string[]>;

function oneOf<T extends string>(allowed: readonly T[], value: string): T | undefined {
  return allowed.find((a) => a === value);
}

function count(value: number): number | undefined {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function matching(pattern: RegExp, value: string | undefined): string | undefined {
  return value !== undefined && pattern.test(value) ? value : undefined;
}

/** Builds the record `log()` writes. Exported for tests. */
export function toRecord(line: LogLine): LogRecord {
  const out: LogRecord = {};
  const put = (key: string, value: string | number | readonly string[] | undefined) => {
    if (value !== undefined) out[key] = value;
  };
  switch (line.event) {
    case 'request':
      put('event', 'request');
      put('method', oneOf(METHODS, line.method) ?? 'other');
      put('route', oneOf(ROUTES, line.route) ?? 'unmatched');
      put('status', count(line.status));
      put('ms', count(Math.round(line.ms)));
      put('colo', matching(/^[A-Z]{3,4}$/, line.colo));
      put('outcome', oneOf(OUTCOMES, line.outcome) ?? 'internal_error');
      put('batch', line.batch instanceof Tag ? line.batch.hex : undefined);
      put('user', line.user instanceof Tag ? line.user.hex : undefined);
      put('i', line.i === undefined ? undefined : count(line.i));
      if (line.query !== undefined) {
        put(
          'query',
          line.query.map((name) => oneOf(QUERY_NAMES, name) ?? 'other'),
        );
      }
      put('bytes', line.bytes === undefined ? undefined : count(line.bytes));
      put('width', line.width === undefined ? undefined : count(line.width));
      put('height', line.height === undefined ? undefined : count(line.height));
      break;
    case 'instagram':
      put('event', 'instagram');
      put('endpoint', oneOf(INSTAGRAM_ENDPOINTS, line.endpoint));
      put('status', count(line.status));
      put('code', line.code === undefined ? undefined : count(line.code));
      put('subcode', line.subcode === undefined ? undefined : count(line.subcode));
      // e.g. `OAuthException`.
      put('type', matching(/^[A-Za-z]{1,64}$/, line.type));
      put('fbtraceId', matching(/^[A-Za-z0-9_-]{1,64}$/, line.fbtraceId));
      // Schema field names only (e.g. `data.0.user_id`), so a tight pattern.
      put('fields', matching(/^[A-Za-z0-9_.,()]{1,200}$/, line.fields));
      break;
    case 'sweep':
      put('event', 'sweep');
      put('listed', count(line.listed));
      put('deleted', count(line.deleted));
      put('pages', count(line.pages));
      put('ms', count(Math.round(line.ms)));
      break;
    case 'exception':
      put('event', 'exception');
      put(
        'route',
        line.route === 'scheduled' ? 'scheduled' : (oneOf(ROUTES, line.route) ?? 'unmatched'),
      );
      put('name', ERROR_NAMES.has(line.name) ? line.name : 'Error');
      break;
  }
  return out;
}

export function log(line: LogLine): void {
  console.log(toRecord(line));
}

/** The query parameter names in `url`, for `RequestLine.query`. */
export function queryNames(url: URL): QueryName[] {
  return Array.from(url.searchParams.keys(), (name) => oneOf(QUERY_NAMES, name) ?? 'other');
}

/** An exception's name, for `ExceptionLine.name`. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}
