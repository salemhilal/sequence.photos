// Rate limits. See README "Abuse and rate limits".

import { HttpError } from './http';
import type { Keys } from './keys';
import { errorName, log, Tag, type Route } from './log';

export type RateLimitScope =
  { kind: 'ip'; group: 'auth' | 'meta' } | { kind: 'user'; userId: string };

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
export async function applyRateLimit(
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
