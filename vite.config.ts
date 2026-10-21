/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from 'vite';
import { VitePWA, type VitePluginPWAAPI } from 'vite-plugin-pwa';

/** The repository, and the website's pages (site/): Vite's root, so its pages are served from it. */
const repo = fileURLToPath(new URL('.', import.meta.url));
const site = resolve(repo, 'site');
const dist = resolve(repo, 'dist');

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function appSlash(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (req.url !== '/app' && !req.url?.startsWith('/app?')) return next();
  res.writeHead(301, { Location: `/app/${req.url.slice(4)}` });
  res.end();
}

/**
 * The web app's security headers, as a Netlify `_headers` file. The Content Security
 * Policy allows only the site's own scripts (plus the hashes of the pages' inline
 * scripts, computed here, so they never go stale) and network requests only to the site,
 * Instagram's API, and Sequence's servers from .env, or a server on this computer for
 * development (Settings → Advanced). It guards the Instagram token the app keeps. The Mac
 * app has its own, in src-tauri/tauri.conf.json. Inline styles: React's style props.
 */
function securityHeaders(env: Record<string, string>, inlineScripts: string[]): string {
  const hashes = inlineScripts.map((code) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`);
  const servers = [env.VITE_SERVER_URL, env.VITE_DEV_SERVER_URL].map((u) => new URL(u ?? '').origin);
  const csp = [
    "default-src 'self'",
    ['script-src', "'self'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    [
      'connect-src',
      // Instagram's API: INSTAGRAM.graphOrigin in src/config.ts (which reads import.meta.env,
      // so can't be loaded here).
      "'self' blob: data: https://graph.instagram.com",
      ...servers,
      'http://localhost:* http://127.0.0.1:*',
    ].join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    // Every page: they share the app's storage, where its Instagram token is kept.
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '',
  ].join('\n');
}

/** Writes dist/_headers (see securityHeaders), and applies it in `vite preview` too. */
function webSecurityHeaders(mode: string): Plugin {
  return {
    name: 'web-security-headers',
    // After the HTML pages are written, so their final inline scripts are hashed.
    writeBundle(options) {
      const dir = options.dir ?? dist;
      const pages = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.html'));
      const inline = pages.flatMap((page) =>
        [...readFileSync(join(dir, page), 'utf8').matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          (m) => m[1] ?? '',
        ),
      );
      const env = loadEnv(mode, repo, 'VITE_');
      writeFileSync(join(dir, '_headers'), securityHeaders(env, inline));
    },
    configurePreviewServer(server) {
      const file = join(dist, '_headers');
      if (!existsSync(file)) return;
      const headers = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('  '))
        .map((line) => line.trim().split(/:\s(.*)/s));
      server.middlewares.use((_req, res, next) => {
        for (const [k, v] of headers) if (k && v) res.setHeader(k, v);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // `--mode app` builds for the native Mac app (see src-tauri), which has no service worker.
  const app = mode === 'app';
  let resolved: ResolvedConfig;
  return {
    // The website's pages are in site/; the app's code in src/, and .env, at the repository's root.
    root: site,
    envDir: repo,
    plugins: [
      react(),
      // Works offline: a service worker (production builds only) caches the whole app,
      // including lazily loaded chunks like the PDF library. Updates wait for the user
      // to reload (see src/update.ts), so a new version never interrupts work. It's the
      // app's alone (/app/): the landing and privacy pages are plain web pages.
      VitePWA({
        // The Mac app has no service worker (its code is never started there; see main.tsx).
        disable: app,
        registerType: 'prompt',
        injectRegister: false,
        filename: 'app/sw.js',
        scope: '/app/',
        // The glob below already caches the icons.
        includeManifestIcons: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff,woff2}'],
          // Not the other pages' (index.html, assets/landing-*, privacy/, support/).
          globIgnores: ['index.html', 'assets/landing-*', 'privacy/**', 'support/**', 'og.jpg'],
          // Its files are listed from the site's root, not from /app/ where it lives.
          modifyURLPrefix: { '': '/' },
          navigateFallback: '/app/index.html',
          // Don't cache old builds' leftovers.
          cleanupOutdatedCaches: true,
          // The first install takes control of open pages right away, so they work
          // offline without a second load. Updates still wait (see src/update.ts).
          clientsClaim: true,
        },
        manifest: {
          name: 'Sequence',
          short_name: 'Sequence',
          description: 'A tool for playing with photo sequences',
          id: '/app/',
          start_url: '/app/',
          scope: '/app/',
          display: 'standalone',
          background_color: '#151514',
          theme_color: '#151514',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
      {
        // modifyURLPrefix (above) misses the entries the PWA plugin adds itself (the web
        // manifest); list those from the root too.
        name: 'app-sw-root-urls',
        configResolved(config) {
          resolved = config;
        },
        // Not configResolved: the plugin's own options aren't resolved yet then.
        buildStart() {
          const pwa = resolved.plugins.find((p) => p.name === 'vite-plugin-pwa')?.api as VitePluginPWAAPI | undefined;
          pwa?.extendManifestEntries((entries) =>
            entries.map((e) => (typeof e === 'string' ? `/${e}` : { ...e, url: `/${e.url}` })),
          );
        },
      },
      {
        // As on Netlify (netlify.toml): the app is at /app/, so /app goes there.
        name: 'app-trailing-slash',
        configureServer: (server) => void server.middlewares.use(appSlash),
        configurePreviewServer: (server) => void server.middlewares.use(appSlash),
      },
      // The website only: the Mac app's policy is in src-tauri/tauri.conf.json.
      ...(app ? [] : [webSecurityHeaders(mode)]),
    ],
    // Where the website and the Mac app differ (see src/platform/types.ts): each build
    // gets its own implementation, so the app's code is never part of the website.
    resolve: {
      alias: [
        {
          find: '#platform',
          replacement: fileURLToPath(
            new URL(app ? './src/platform/macos/index.ts' : './src/platform/browser.ts', import.meta.url),
          ),
        },
        // The app's page (site/app/index.html) loads /src/main.tsx: the repository's src/,
        // outside Vite's root.
        { find: /^\/src\//, replacement: `${resolve(repo, 'src')}/` },
      ],
    },
    build: {
      outDir: dist,
      emptyOutDir: true,
      rollupOptions: {
        // The website: a landing page (/), the app (/app/), a privacy policy (/privacy/, which
        // the Mac app links to), and a support page (/support/). The Mac app is just the app.
        input: app
          ? resolve(site, 'app/index.html')
          : {
              landing: resolve(site, 'index.html'),
              app: resolve(site, 'app/index.html'),
              privacy: resolve(site, 'privacy/index.html'),
              support: resolve(site, 'support/index.html'),
            },
      },
    },
    // site/public/ is the website's (its icons, share image, and old service worker's
    // remover); the Mac app uses none of it. See scripts/check-app-bundle.mjs.
    publicDir: app ? false : 'public',
    // Pre-bundle lucide-react with React up front; discovering it mid-session
    // can load it against a second copy of React ("Invalid hook call").
    optimizeDeps: { include: ['lucide-react'] },
    // Inlined at build time; see src/env.d.ts.
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // The Mac app's end-to-end test build (npm run test:app).
      __E2E__: JSON.stringify(process.env.PBS_E2E_BUILD === '1'),
    },
    // `npm run dev`: the address the development Instagram client (INSTAGRAM.clients in
    // src/config.ts) and server know. The Mac app's dev UI uses its own (--port 5176).
    server: { port: 5175, strictPort: true },
    // Tauri's dev server output reads better without Vite clearing the terminal.
    clearScreen: false,
    test: {
      root: repo,
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
