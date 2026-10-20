/**
 * Which window this page is. The Mac app opens Settings and Layout in windows of their own,
 * the same page with `?window=settings` or `?window=layout`; everywhere else, and in the
 * app's main window, it's the app.
 */
const kind = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('window') : null;

export const isSettingsWindow = kind === 'settings';
export const isLayoutWindow = kind === 'layout';
/** The main window: the one with the project (the others mirror it). */
export const isMainWindow = !isSettingsWindow && !isLayoutWindow;
