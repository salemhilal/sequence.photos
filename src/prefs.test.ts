import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPref, deskColorPref, sidebarOpenPref, sidebarWidthPref, themePref } from './prefs';

const store = new Map<string, string>();
let broken = false;
vi.stubGlobal('localStorage', {
  getItem: (k: string) => {
    if (broken) throw new Error('blocked');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (broken) throw new Error('blocked');
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
});

beforeEach(() => {
  store.clear();
  broken = false;
});

describe('createPref', () => {
  const pref = createPref('k', 5, (raw) => (Number(raw) > 0 ? Number(raw) : undefined));

  it('falls back to the default when missing, invalid, or storage is blocked', () => {
    expect(pref.load()).toBe(5);
    store.set('k', '-3');
    expect(pref.load()).toBe(5);
    broken = true;
    expect(pref.load()).toBe(5);
    expect(() => pref.save(9)).not.toThrow();
  });

  it('stores only non-default values', () => {
    pref.save(9);
    expect(store.get('k')).toBe('9');
    expect(pref.load()).toBe(9);
    pref.save(5);
    expect(store.has('k')).toBe(false);
  });
});

describe('app preferences', () => {
  it('read values saved by earlier versions', () => {
    store.set('photobook-theme', 'dark');
    store.set('photobook-desk', '#2E4A3F');
    store.set('photobook-sidebar', 'closed');
    store.set('photobook-sidebar-width', '640');
    expect([themePref.load(), deskColorPref.load(), sidebarOpenPref.load(), sidebarWidthPref.load()]).toEqual([
      'dark',
      '#2e4a3f',
      false,
      640,
    ]);
  });

  it('ignore junk', () => {
    store.set('photobook-theme', 'sepia');
    store.set('photobook-desk', 'red');
    store.set('photobook-sidebar-width', '12');
    expect([themePref.load(), deskColorPref.load(), sidebarWidthPref.load()]).toEqual(['system', '#787878', 284]);
  });
});
