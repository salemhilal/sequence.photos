/**
 * Everything the app is configured with: its addresses, and its Instagram app. Values
 * come from .env (the one place to change them), inlined by Vite at build time; nothing
 * else reads `import.meta.env`. The website's pages use the same values as
 * `%VITE_…%` placeholders, and its Content Security Policy is built from them too (see
 * vite.config.ts).
 */

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is missing from .env`);
  return value;
}

const env = import.meta.env;

/** The website, e.g. https://sequence.photos. */
export const SITE_URL = `https://${required('VITE_SITE_DOMAIN', env.VITE_SITE_DOMAIN)}`;
export const PRIVACY_URL = `${SITE_URL}/privacy/`;
export const REPO_URL = required('VITE_REPO_URL', env.VITE_REPO_URL);
export const APP_STORE_URL = required('VITE_APP_STORE_URL', env.VITE_APP_STORE_URL);

/**
 * Sequence's servers (`server/`), for posting to Instagram: the one the
 * app uses by default, and the development one Settings → Advanced can switch to.
 */
export const SERVER_URL = required('VITE_SERVER_URL', env.VITE_SERVER_URL);
export const DEV_SERVER_URL = required('VITE_DEV_SERVER_URL', env.VITE_DEV_SERVER_URL);

const GRAPH_ORIGIN = 'https://graph.instagram.com';

/** Instagram API with Instagram Login. The app id is public (it's in every sign-in URL). */
export const INSTAGRAM = {
  appId: required('VITE_INSTAGRAM_APP_ID', env.VITE_INSTAGRAM_APP_ID),
  authorizeUrl: 'https://www.instagram.com/oauth/authorize',
  /** Instagram's API, which the Content Security Policies allow (see vite.config.ts). */
  graphOrigin: GRAPH_ORIGIN,
  /** Matches the server's GRAPH_VERSION (sequence-server's wrangler.jsonc). */
  graphUrl: `${GRAPH_ORIGIN}/v26.0`,
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  /**
   * Where the server sends someone back after signing in, by the app's address: the
   * `client` in the sign-in state, which the server looks up in its RETURN_URLS. Only the
   * development server knows `dev` (this computer's `npm run dev`); `mac` is the Mac app
   * (its pages' origin), which comes back through its `sequence-photos://` link.
   */
  clients: { [SITE_URL]: 'web', 'http://localhost:5175': 'dev', 'tauri://localhost': 'mac' } as Readonly<
    Record<string, 'web' | 'dev' | 'mac'>
  >,
} as const;
