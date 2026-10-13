// Sign-in: /auth/callback, /auth/redeem, /auth/renew. See README "Sign-in".

import * as v from 'valibot';
import type { InstagramConnection, InstagramError, RenewResponse } from './api';
import { sha256Base64Url } from './encoding';
import { HttpError, jsonResponse, parseBearer, parseState, readJson, type Handler } from './http';
import {
  exchangeCode,
  exchangeLongLived,
  getMe,
  isProfessional,
  PUBLISH_PERMISSION,
  type Failure,
} from './instagram';
import {
  ENROLL_RENEW_GRACE,
  isUserId,
  makeEnrollment,
  readEnrollment,
  seal,
  timingSafeEqualStrings,
  unseal,
} from './keys';
import { Tag, type Outcome } from './log';

/** Instagram usernames: letters, digits, periods, underscores (30 max; some slack). */
const USERNAME = /^[A-Za-z0-9._]{1,64}$/;

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

function failureOutcome(failure: Failure): Outcome {
  return failure === 'unavailable' ? 'instagram_unavailable' : 'exchange_failed';
}

/** `GET /auth/callback`: Instagram's OAuth redirect. */
export const callback: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'auth' });
  const params = ctx.url.searchParams;

  // Until the state is known good, there's nowhere safe to redirect: plain 400.
  const rawState = params.get('state');
  const state = parseState(rawState);
  if (!state || rawState === null) throw new HttpError(400, 'bad_state');
  const returnUrl = ctx.config.returnUrls.get(state.client);
  if (returnUrl === undefined) throw new HttpError(400, 'unknown_client');

  // From here on, every outcome goes back to the app. `rawState` matched the strict
  // state format, so it's safe in the fragment as is.
  const fail = (error: InstagramError, outcome: Outcome): Response => {
    ctx.log.outcome = outcome;
    return redirect(`${returnUrl}#instagram_error=${error}&state=${rawState}`);
  };

  if (params.has('error')) return fail('cancelled', 'cancelled');

  // Instagram may append `#_` to the code.
  const code = params.get('code')?.replace(/#_$/, '');
  if (code === undefined || !/^[\x21-\x7E]{1,4096}$/.test(code)) {
    return fail('exchange_failed', 'bad_request');
  }

  const shortLived = await exchangeCode(ctx.config, ctx.env.IG_APP_SECRET, code);
  if (!shortLived.ok) return fail('exchange_failed', failureOutcome(shortLived.failure));
  if (!shortLived.value.permissions.includes(PUBLISH_PERMISSION)) {
    return fail('missing_permission', 'missing_permission');
  }

  const longLived = await exchangeLongLived(ctx.env.IG_APP_SECRET, shortLived.value.token);
  if (!longLived.ok) return fail('exchange_failed', failureOutcome(longLived.failure));

  const me = await getMe(ctx.config, longLived.value.token, ['username', 'account_type']);
  if (!me.ok) return fail('exchange_failed', failureOutcome(me.failure));
  // The professional account's id from /me, not the one from the code exchange.
  const { userId, username, accountType } = me.value;
  ctx.log.user = await Tag.user(ctx.keys.log, userId);
  if (!isProfessional(accountType)) return fail('not_professional', 'not_professional');
  if (username === undefined || !USERNAME.test(username)) {
    return fail('exchange_failed', 'exchange_failed');
  }

  const connection: InstagramConnection = {
    token: longLived.value.token,
    expiresAt: ctx.now + longLived.value.expiresIn,
    refreshedAt: ctx.now,
    userId,
    username,
    enrollment: await makeEnrollment(ctx.keys, userId, ctx.now),
  };
  const sealed = await seal(ctx.keys, { connection, challenge: state.challenge }, ctx.now);
  return redirect(`${returnUrl}#instagram=${sealed}&state=${rawState}`);
};

const RedeemBody = v.strictObject({
  sealed: v.pipe(v.string(), v.maxLength(4096)),
  verifier: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
});

/** `POST /auth/redeem`: the sealed handoff + the app's verifier → the connection. */
export const redeem: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'auth' });
  // Anything wrong is a 400 with no detail, including an oversize body.
  const body = await readJson(ctx.request, 4096, RedeemBody).catch((error: unknown) => {
    throw error instanceof HttpError ? new HttpError(400, error.outcome) : error;
  });
  const handoff = await unseal(ctx.keys, body.sealed, ctx.now);
  if (!handoff) throw new HttpError(400, 'bad_request');
  if (!timingSafeEqualStrings(await sha256Base64Url(body.verifier), handoff.challenge)) {
    throw new HttpError(400, 'bad_request');
  }
  ctx.log.user = await Tag.user(ctx.keys.log, handoff.connection.userId);
  return jsonResponse(handoff.connection);
};

const RenewBody = v.strictObject({
  enrollment: v.pipe(v.string(), v.maxLength(512)),
});

/** `POST /auth/renew`: a still-recent enrollment + a token for the same user → a new one. */
export const renew: Handler = async (ctx) => {
  await ctx.rateLimit({ kind: 'ip', group: 'auth' });
  const token = parseBearer(ctx.request.headers.get('Authorization'));
  if (token === null) throw new HttpError(401, 'unauthorized');
  const body = await readJson(ctx.request, 4096, RenewBody);

  const enrollment = await readEnrollment(ctx.keys, body.enrollment, ctx.now, ENROLL_RENEW_GRACE);
  if (!enrollment.ok) {
    throw new HttpError(401, enrollment.reason === 'expired' ? 'expired' : 'bad_signature');
  }
  ctx.log.user = await Tag.user(ctx.keys.log, enrollment.userId);

  const me = await getMe(ctx.config, token);
  if (!me.ok) {
    throw me.failure === 'unavailable'
      ? new HttpError(502, 'instagram_unavailable')
      : new HttpError(401, 'unauthorized');
  }
  if (!isUserId(me.value.userId) || me.value.userId !== enrollment.userId) {
    throw new HttpError(401, 'enrollment_mismatch');
  }

  const response: RenewResponse = {
    enrollment: await makeEnrollment(ctx.keys, enrollment.userId, ctx.now),
  };
  return jsonResponse(response);
};
