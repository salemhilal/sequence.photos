import { describe, expect, it } from 'vitest';
import { DEV_SERVER_URL, SERVER_URL, SITE_URL } from './config';
import { defaultServerUrl, normalizeServerUrl } from './server';

describe('normalizeServerUrl', () => {
  it("accepts Sequence's servers, as their origins", () => {
    expect(normalizeServerUrl(` ${SERVER_URL}/ `)).toBe(SERVER_URL);
    expect(normalizeServerUrl(DEV_SERVER_URL)).toBe(DEV_SERVER_URL);
  });

  it('accepts plain http on this computer', () => {
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServerUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
  });

  it('refuses anything else (the Content Security Policy would block it)', () => {
    for (const bad of [
      '',
      'not a url',
      'https://example.com',
      'http://example.com',
      'https://localhost:8787',
      `${SERVER_URL}/path`,
      `${SERVER_URL}/?q=1`,
      'ftp://localhost',
      'javascript:alert(1)',
    ]) {
      expect(normalizeServerUrl(bad), bad).toBeNull();
    }
  });
});

describe('defaultServerUrl', () => {
  it("is Sequence's server on the website, and the development server on this computer", () => {
    expect(defaultServerUrl(SITE_URL)).toBe(SERVER_URL);
    expect(defaultServerUrl('http://localhost:5175')).toBe(DEV_SERVER_URL);
  });
});
