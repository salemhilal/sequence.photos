// Usage metrics: one Workers Analytics Engine data point per counted event, read by
// `npm run metrics` (scripts/metrics.ts) through Cloudflare's SQL API. See README "Metrics".
//
// Like the logs, metrics never hold a token, an Instagram id, or a batch id: users and
// batches are the same short keyed hashes (`Tag`s) the logs use.

import type { PostResult } from './api';
import type { Tag } from './log';

/** `DELETE /uploads/<id>`'s `result`, or `unreported` if missing or unknown (older apps). */
export type PostOutcome = PostResult | 'unreported';

const POST_RESULTS: readonly PostResult[] = ['posted', 'failed', 'cancelled'];

/** Reads `result` from a DELETE's query; anything else is `unreported`, never an error. */
export function parsePostResult(value: string | null): PostOutcome {
  return POST_RESULTS.find((r) => r === value) ?? 'unreported';
}

/** A counted event. */
export type Metric =
  /** A sign-in finished: the app redeemed its connection. */
  | { event: 'connect'; user: Tag }
  /** The app renewed a connection's enrollment (it does when it refreshes the token). */
  | { event: 'renew'; user: Tag }
  /** A batch was started for `frames` frames. */
  | { event: 'batch'; user: Tag; batch: Tag; frames: number }
  /** One frame was stored. */
  | { event: 'frame'; batch: Tag; bytes: number }
  /** The app deleted a batch's frames after posting, failing, or cancelling. */
  | { event: 'post'; batch: Tag; result: PostOutcome; frames: number };

/**
 * The dataset's columns, fixed so saved queries keep working: `index1` and `blob1` are the
 * event, `blob2` the user tag, `blob3` the batch tag, `blob4` the post result; `double1`
 * is frames, `double2` bytes. Missing values are '' and 0.
 */
export function toDataPoint(metric: Metric): AnalyticsEngineDataPoint {
  const user = 'user' in metric ? metric.user.hex : '';
  const batch = 'batch' in metric ? metric.batch.hex : '';
  const result = metric.event === 'post' ? metric.result : '';
  const frames = 'frames' in metric ? metric.frames : 0;
  const bytes = metric.event === 'frame' ? metric.bytes : 0;
  return {
    indexes: [metric.event],
    blobs: [metric.event, user, batch, result],
    doubles: [frames, bytes],
  };
}

/** Writes one metric. Never throws: a lost data point must not fail the request. */
export function record(dataset: AnalyticsEngineDataset, metric: Metric): void {
  try {
    dataset.writeDataPoint(toDataPoint(metric));
  } catch {
    // Nothing to do: metrics are best effort.
  }
}
