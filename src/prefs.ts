import { DEFAULT_DESK, isHexColor } from './deskColor';
import type { ThemePref } from './theme';

/**
 * Per-browser viewing preferences, kept in localStorage (not in the project,
 * and not in undo history). Storage can be unavailable (private mode, blocked
 * site data), so reads fall back to the default and failed writes are ignored:
 * the choice still applies for the session.
 */
export interface Pref<T> {
  load(): T;
  save(value: T): void;
}

export function createPref<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T | undefined,
  serialize: (value: T) => string = String,
): Pref<T> {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (parse(raw) ?? fallback);
      } catch {
        return fallback;
      }
    },
    save(value) {
      try {
        // Storing only non-defaults keeps storage clean and lets defaults change later.
        if (value === fallback) localStorage.removeItem(key);
        else localStorage.setItem(key, serialize(value));
      } catch {
        // Not persisted.
      }
    },
  };
}

export const SIDEBAR_DEFAULT_WIDTH = 284;
export const SIDEBAR_MIN_WIDTH = 240;

// The theme and desk keys are also read by the inline script in app/index.html, before first paint.
export const themePref = createPref<ThemePref>('photobook-theme', 'system', (raw) =>
  raw === 'light' || raw === 'dark' ? raw : undefined,
);

export const deskColorPref = createPref('photobook-desk', DEFAULT_DESK, (raw) =>
  isHexColor(raw) ? raw.toLowerCase() : undefined,
);

export const sidebarOpenPref = createPref(
  'photobook-sidebar',
  true,
  (raw) => raw !== 'closed',
  (open) => (open ? 'open' : 'closed'),
);

/** Whether the status bar shows along the window's foot. */
export const statusBarPref = createPref(
  'photobook-status-bar',
  true,
  (raw) => raw !== 'hidden',
  (shown) => (shown ? 'shown' : 'hidden'),
);

/** Whether holding ⌘ (Ctrl) shows each button's shortcut. */
export const shortcutBadgesPref = createPref(
  'photobook-shortcut-badges',
  true,
  (raw) => raw !== 'hidden',
  (shown) => (shown ? 'shown' : 'hidden'),
);

export const sidebarWidthPref = createPref('photobook-sidebar-width', SIDEBAR_DEFAULT_WIDTH, (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= SIDEBAR_MIN_WIDTH ? n : undefined;
});

/** How many columns of spreads (or frames) the sidebar shows, as many as fit (1 to 4). */
export const SIDEBAR_MAX_COLUMNS = 4;
export const sidebarColumnsPref = createPref('photobook-sidebar-columns', 1, (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= SIDEBAR_MAX_COLUMNS ? n : undefined;
});

/** Which of the Layout panel's sections are folded away. */
export const collapsedPref = createPref<string[]>(
  'photobook-layout-collapsed',
  [],
  (raw) => {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    } catch {
      return undefined;
    }
  },
  (ids) => JSON.stringify(ids),
);

/** Whether this browser has been shown the product tour (it starts on its own only once). */
export const tourSeenPref = createPref(
  'photobook-tour',
  false,
  (raw) => raw === 'seen',
  (seen) => (seen ? 'seen' : ''),
);
