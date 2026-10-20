/**
 * Which window this page is. The Mac app opens Settings in a window of its own, the same
 * page with `?window=settings`; everywhere else, and in the app's main window, it's the app.
 */
export const isSettingsWindow =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('window') === 'settings';

/** The main window: the one with the project. */
export const isMainWindow = !isSettingsWindow;
