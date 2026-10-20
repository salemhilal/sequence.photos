// Request and response types shared with the app. Dependency-free, so the app can vendor
// a copy of this file.

export interface InstagramConnection {
  /** Instagram long-lived token. */
  token: string;
  /** Unix seconds: when the token expires, and when it was issued or last refreshed. */
  expiresAt: number;
  refreshedAt: number;
  /** The professional account's id (from /me), used for publishing. */
  userId: string;
  username: string;
  /** Sequence's enrollment credential (see README "Enrollment"). */
  enrollment: string;
}

export interface UploadBatch {
  id: string;
  frames: { put: string; url: string }[];
  delete: string;
}

export type InstagramError =
  'cancelled' | 'exchange_failed' | 'missing_permission' | 'not_professional';

/** `POST /auth/redeem` body. */
export interface RedeemRequest {
  sealed: string;
  verifier: string;
}

/** `POST /auth/renew` body (with `Authorization: Bearer <token>`). */
export interface RenewRequest {
  enrollment: string;
}

/** `POST /auth/renew` response. */
export interface RenewResponse {
  enrollment: string;
}

/** `POST /uploads` body (with `Authorization: Bearer <token>`). */
export interface UploadsRequest {
  enrollment: string;
  count: number;
}

/**
 * How a post went, sent as `DELETE /uploads/<id>`'s `result` query parameter (the app
 * appends it to the signed URL) so the server can count posts. See README "Metrics".
 */
export type PostResult = 'posted' | 'failed' | 'cancelled';
