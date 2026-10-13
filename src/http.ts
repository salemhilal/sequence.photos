// Errors, JSON responses, and request bodies.

import * as v from 'valibot';
import { parseJsonWith } from './formats';
import type { Outcome } from './log';

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

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Bodies ---------------------------------------------------------------------------

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

/** JSON request bodies (redeem, renew, uploads) are small. Larger → 413 (400 for redeem). */
export const MAX_JSON_BODY = 4096;

/** Reads a JSON body of at most `max` bytes and parses it with `schema`; else 400. */
export async function readJson<S extends v.GenericSchema>(
  request: Request,
  max: number,
  schema: S,
): Promise<v.InferOutput<S>> {
  const body = parseJsonWith(schema, await readBody(request, max));
  if (body === null) throw new HttpError(400, 'bad_request');
  return body;
}
