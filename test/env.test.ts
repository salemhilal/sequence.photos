import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/env';

describe('config', () => {
  it('parses the dev environment', () => {
    const config = parseConfig(env);
    expect(config.maxFrames).toBe(10);
    expect(config.returnUrls.get('dev')).toBe('http://localhost:5175/app/');
    expect(config.allowedOrigins.has('http://localhost:5175')).toBe(true);
  });

  it('refuses invalid vars, naming the var but not its value', () => {
    expect(() => parseConfig({ ...env, RETURN_URLS: '{"web":"javascript:alert(1)"}' })).toThrow(
      'RETURN_URLS is invalid',
    );
    expect(() => parseConfig({ ...env, ALLOWED_ORIGINS: '["https://a.test/path"]' })).toThrow(
      'ALLOWED_ORIGINS is invalid',
    );
    expect(() => parseConfig({ ...env, MAX_FRAMES: '100' })).toThrow('MAX_FRAMES is invalid');
    expect(() => parseConfig({ ...env, RETURN_URLS: 'secret-ish{' })).toThrow(
      'RETURN_URLS is invalid',
    );
  });
});
