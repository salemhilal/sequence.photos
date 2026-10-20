import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { contentLength, HttpError, readBody, readJson } from '../src/http';

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected an HttpError');
}

describe('Content-Length', () => {
  it('is a decimal number, or absent', () => {
    const req = (length?: string) =>
      new Request('https://server.test/', {
        method: 'POST',
        headers: length === undefined ? {} : { 'Content-Length': length },
      });
    expect(contentLength(req('12'))).toBe(12);
    expect(contentLength(req())).toBeNull();
    expect(() => contentLength(req('-1'))).toThrow(HttpError);
    expect(() => contentLength(req('012'))).toThrow(HttpError);
  });
});

describe('bodies', () => {
  const post = (body: BodyInit) => new Request('https://server.test/', { method: 'POST', body });

  it('reads a body within the limit', async () => {
    expect(await readBody(post('hello'), 5)).toEqual(new TextEncoder().encode('hello'));
  });

  it('rejects a declared length over the limit before reading', async () => {
    expect((await rejection(readBody(post('hello!'), 5))).status).toBe(413);
  });

  it('stops reading a streamed body that runs over the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
    });
    const error = await rejection(readBody(post(stream), 10));
    expect(error.status).toBe(413);
    expect(error.outcome).toBe('too_large');
  });

  it('parses JSON against a schema, and nothing else', async () => {
    const schema = v.strictObject({ a: v.number() });
    expect(await readJson(post('{"a":1}'), 100, schema)).toEqual({ a: 1 });
    for (const body of ['{"a":"1"}', '{"a":1,"b":2}', 'not json', '', '[]']) {
      expect((await rejection(readJson(post(body), 100, schema))).status).toBe(400);
    }
    const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]);
    expect((await rejection(readJson(post(invalidUtf8), 100, schema))).status).toBe(400);
  });
});
