// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasPendingSignIn } from './instagram';
import { onSettingSaved, reloadSettings, setShortcutBadges, setStatusBar, setTheme, ui } from './ui';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  onSettingSaved(() => {});
});

describe('settings across windows', () => {
  it('tells the other windows when a setting is saved here', () => {
    const told = vi.fn();
    onSettingSaved(told);
    setTheme('dark');
    setStatusBar(false);
    setShortcutBadges(false);
    expect(told).toHaveBeenCalledTimes(3);
    setStatusBar(true);
    setShortcutBadges(true);
    setTheme('system');
  });

  it('loads what another window saved: the theme, desk color, status bar, and shortcut badges', () => {
    localStorage.setItem('photobook-theme', 'light');
    localStorage.setItem('photobook-desk', '#334455');
    localStorage.setItem('photobook-status-bar', 'hidden');
    localStorage.setItem('photobook-shortcut-badges', 'hidden');
    reloadSettings();
    expect(ui.get()).toMatchObject({ theme: 'light', deskColor: '#334455', statusBar: false, shortcutBadges: false });
    expect(document.documentElement.style.getPropertyValue('--desk')).toBe('#334455');
    localStorage.clear();
    reloadSettings();
    expect(ui.get()).toMatchObject({ theme: 'system', statusBar: true, shortcutBadges: true });
  });
});

describe('hasPendingSignIn', () => {
  it('is whether this window started an Instagram sign-in that hasn’t come back', () => {
    expect(hasPendingSignIn()).toBe(false);
    sessionStorage.setItem('photobook-instagram-pending', '{}');
    expect(hasPendingSignIn()).toBe(true);
  });
});
