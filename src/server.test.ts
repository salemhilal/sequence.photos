import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './server';

describe('normalizeServerUrl', () => {
  it('keeps https addresses as their origin', () => {
    expect(normalizeServerUrl(' https://sequence-server.example.workers.dev/ ')).toBe(
      'https://sequence-server.example.workers.dev',
    );
    expect(normalizeServerUrl('https://api.sequence.photos')).toBe('https://api.sequence.photos');
  });

  it('allows plain http only on this computer', () => {
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServerUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(normalizeServerUrl('http://example.com')).toBeNull();
  });

  it('refuses anything else', () => {
    for (const bad of [
      '',
      'not a url',
      'ftp://example.com',
      'https://example.com/path',
      'https://a:b@example.com',
      'https://example.com/?q=1',
      'javascript:alert(1)',
    ]) {
      expect(normalizeServerUrl(bad)).toBeNull();
    }
  });
});
