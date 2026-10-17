/** Read only by src/config.ts. */
interface ImportMetaEnv {
  /** The website's domain (see .env). */
  readonly VITE_SITE_DOMAIN: string;
  /** The Mac app's App Store page (see .env). */
  readonly VITE_APP_STORE_URL: string;
  /** The source code's URL (see .env). */
  readonly VITE_REPO_URL: string;
  /** Sequence's servers, for posting to Instagram (see .env). */
  readonly VITE_SERVER_URL: string;
  readonly VITE_DEV_SERVER_URL: string;
  /** The Instagram app's id (see .env). */
  readonly VITE_INSTAGRAM_APP_ID: string;
}

/** The app's version from package.json, inlined by Vite at build time. */
declare const __APP_VERSION__: string;

/** Whether this is the Mac app's end-to-end test build (see src/platform/macos/e2e.ts). */
declare const __E2E__: boolean;
