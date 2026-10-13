import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ROUTE_TABLE } from '../src/index';
import { handleRequest } from '../src/router';
import { captureLogs } from './helpers';

describe('router', () => {
  function fetchWorker(input: string, init?: RequestInit): Promise<Response> {
    return exports.default.fetch(`https://server.test${input}`, init);
  }

  it('404s unknown paths, with the default headers', async () => {
    const response = await fetchWorker('/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('405s a known path with the wrong method', async () => {
    const response = await fetchWorker('/auth/redeem');
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers CORS preflights for allowed origins only', async () => {
    const allowed = await fetchWorker('/uploads/AAAAAAAAAAAAAAAAAAAAAA/0.jpg', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5175', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5175');
    expect(allowed.headers.get('Access-Control-Allow-Methods')).toBe('POST, PUT, DELETE');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');

    const logs = captureLogs();
    const denied = await fetchWorker('/uploads', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.test' },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(logs.records()[0]).toMatchObject({
      route: 'OPTIONS /uploads',
      outcome: 'forbidden_origin',
    });
  });

  it('has no CORS on routes outside the list', async () => {
    const response = await fetchWorker('/auth/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5175' },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to responses for allowed origins', async () => {
    const response = await fetchWorker('/auth/redeem', {
      method: 'POST',
      headers: { Origin: 'https://sequence.photos' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://sequence.photos');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('answers a plain 500, logging no config values, when the config is invalid', async () => {
    const logs = captureLogs();
    const badEnv = { ...env, RETURN_URLS: '{"web":"javascript:alert(1)"}' };
    const response = await handleRequest(
      new Request('https://server.test/uploads', {
        method: 'POST',
        headers: { Origin: 'http://localhost:5175' },
      }),
      badEnv,
      ROUTE_TABLE,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(logs.records()).toEqual([
      { event: 'exception', route: 'unmatched', name: 'Error' },
      expect.objectContaining({ event: 'request', status: 500, outcome: 'internal_error' }),
    ]);
    for (const line of logs.lines()) expect(line).not.toContain('javascript');
  });
});
