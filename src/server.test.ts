// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_SERVER_URL, SERVER_URL, SITE_URL } from './config';
import { defaultServerUrl, normalizeServerUrl, serverUrl, serverUrlPref } from './server';

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

describe('serverUrl', () => {
  const setUrl = (url: string) =>
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

  afterEach(() => localStorage.clear());

  it('is the default for where the app runs, until this browser chooses one', () => {
    setUrl(`${SITE_URL}/app/`);
    expect(serverUrl()).toBe(SERVER_URL);
    setUrl('http://localhost:5175/');
    expect(serverUrl()).toBe(DEV_SERVER_URL);
    serverUrlPref.save('http://localhost:8787');
    expect(serverUrl()).toBe('http://localhost:8787');
    serverUrlPref.save('');
    expect(serverUrl()).toBe(DEV_SERVER_URL);
  });

  it('ignores a stored choice the app can’t use, and keeps none for the default', () => {
    setUrl(`${SITE_URL}/app/`);
    localStorage.setItem('photobook-server-url', 'https://example.com');
    expect(serverUrlPref.load()).toBe('');
    expect(serverUrl()).toBe(SERVER_URL);
    localStorage.setItem('photobook-server-url', `${DEV_SERVER_URL}/`);
    expect(serverUrl()).toBe(DEV_SERVER_URL);
    serverUrlPref.save('');
    expect(localStorage.getItem('photobook-server-url')).toBeNull();
  });
});
