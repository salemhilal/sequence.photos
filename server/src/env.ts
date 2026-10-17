// The Worker's environment. `Env` itself is a global type generated from wrangler.jsonc
// by `npm run types` (worker-configuration.d.ts); this module parses its string vars into
// a typed, validated `Config` once per isolate.

import * as v from 'valibot';
import { CLIENT_NAME, MAX_FRAMES_PATTERN, parseJsonWith } from './formats';

export interface Config {
  igAppId: string;
  /** e.g. `v26.0`. */
  graphVersion: string;
  callbackUrl: string;
  /** `client` → return URL, from `RETURN_URLS`. */
  returnUrls: ReadonlyMap<string, string>;
  allowedOrigins: ReadonlySet<string>;
  maxFrames: number;
}

const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.check((s) => /^https?:\/\//.test(s), 'must be http(s)'),
);
const origin = v.pipe(
  httpUrl,
  v.check((s) => new URL(s).origin === s, 'must be a bare origin'),
);

// No fragment: the callback appends its own (`#instagram=…`).
const returnUrl = v.pipe(
  httpUrl,
  v.check((s) => !s.includes('#'), 'must not have a fragment'),
);
const ReturnUrlsSchema = v.record(v.pipe(v.string(), v.regex(CLIENT_NAME)), returnUrl);
const AllowedOriginsSchema = v.array(origin);

/** Parses and validates the vars. Throws (naming the var, never its value) if invalid. */
export function parseConfig(env: Env): Config {
  const returnUrls = parseJsonWith(ReturnUrlsSchema, env.RETURN_URLS);
  if (returnUrls === null) throw new Error('RETURN_URLS is invalid');
  const allowedOrigins = parseJsonWith(AllowedOriginsSchema, env.ALLOWED_ORIGINS);
  if (allowedOrigins === null) throw new Error('ALLOWED_ORIGINS is invalid');

  if (!MAX_FRAMES_PATTERN.test(env.MAX_FRAMES)) throw new Error('MAX_FRAMES is invalid');
  if (!/^v[0-9]+\.[0-9]+$/.test(env.GRAPH_VERSION)) throw new Error('GRAPH_VERSION is invalid');
  if (!v.is(httpUrl, env.CALLBACK_URL)) throw new Error('CALLBACK_URL is invalid');
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(env.IG_APP_ID)) throw new Error('IG_APP_ID is invalid');

  return {
    igAppId: env.IG_APP_ID,
    graphVersion: env.GRAPH_VERSION,
    callbackUrl: env.CALLBACK_URL,
    returnUrls: new Map(Object.entries(returnUrls)),
    allowedOrigins: new Set(allowedOrigins),
    maxFrames: Number(env.MAX_FRAMES),
  };
}

// Cached per isolate. Keyed on the env object so tests with different bindings each get
// their own.
const configs = new WeakMap<Env, Config>();

export function getConfig(env: Env): Config {
  let config = configs.get(env);
  if (!config) {
    config = parseConfig(env);
    configs.set(env, config);
  }
  return config;
}
