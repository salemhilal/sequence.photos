/**
 * What differs between the website and the Mac app. Shared code imports `platform`
 * from '#platform', which each build points at its own implementation (see
 * vite.config.ts): ./browser.ts for the website, ./macos/ for the app. So the app's
 * code is never part of the website, and anything added here must be implemented by
 * both. Wording that differs is written where it's used, switching on `kind`.
 */
export interface Platform {
  kind: 'browser' | 'macos';

  /** Set up what this platform needs at startup. */
  start(): void;

  /**
   * Save a file the app makes, once `make` has made it. The Mac app asks where first
   * (so nothing is made if that's cancelled); the website downloads it when it's done.
   * Resolves to whether it was saved.
   */
  saveFile(filename: string, make: () => Promise<Blob>): Promise<boolean>;

  /** Keep the project: export a copy (website) or save it to its file (Mac app). Resolves to whether it was kept. */
  keepProject(): Promise<boolean>;

  /** Save As, where there are project files to save to (the Mac app). */
  keepProjectAs?: () => Promise<boolean>;

  /** Choose a project file and open it. */
  openProject(): void;

  /** Whether replacing the project now would lose nothing (it's all saved to its file). */
  projectIsSafe(): boolean;

  /** The project was replaced: by a new, empty one, or by one opened without a file behind it. */
  projectReplaced(): void;

  /**
   * Open Instagram's sign-in page: in this window (the website, which comes back to its own
   * address), or in the browser (the Mac app, which comes back through its link).
   */
  openSignIn(url: string): 'here' | 'browser';

  /**
   * Call `finish` with each Instagram sign-in that comes back (its URL's fragment): at
   * startup, from the address (the website), or whenever the app's link arrives (the Mac app).
   */
  onSignInReturn(finish: (fragment: string) => void): void;

  /**
   * Make the window fullscreen, or not, to present the preview: the browser's Fullscreen API
   * on the website, the window's own fullscreen in the Mac app.
   */
  setFullscreen(on: boolean): void;

  /** Call `change` when the window goes in or out of fullscreen (also by other means: the browser's Esc, the green button); returns a stop. */
  watchFullscreen(change: (on: boolean) => void): () => void;
}
