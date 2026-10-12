interface ImportMetaEnv {
  /** The website's domain (see .env). */
  readonly VITE_SITE_DOMAIN: string;
  /** The Mac app's App Store page (see .env). */
  readonly VITE_APP_STORE_URL: string;
  /** Sequence's server, for posting to Instagram; empty until it's deployed (see .env). */
  readonly VITE_SERVER_URL: string;
}

/** The app's version from package.json, inlined by Vite at build time. */
declare const __APP_VERSION__: string;

/** Whether this is the Mac app's end-to-end test build (see src/platform/macos/e2e.ts). */
declare const __E2E__: boolean;
