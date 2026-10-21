// Fails if the Mac app's build (dist/, from `npm run app:ui:build`) contains
// anything of the website's: its landing page, privacy policy, or public/ files. The
// app is only app/index.html and the assets it loads (see vite.config.ts); the
// website's pages are never built for it, and this makes sure it stays that way.
// The reverse check is scripts/check-web-bundle.mjs.

import { readdirSync } from 'node:fs';

const files = readdirSync('dist', { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile())
  .map((f) => `${f.parentPath.slice('dist'.length + 1)}/${f.name}`.replace(/^\//, ''));
const extra = files.filter(
  (f) => f !== 'app/index.html' && !(f.startsWith('assets/') && !f.startsWith('assets/landing-')),
);

if (!files.includes('app/index.html')) {
  console.error('dist/ isn’t the Mac app’s build (no app/index.html). Run npm run app:ui:build first.');
  process.exit(1);
}
if (extra.length) {
  console.error(`The Mac app’s build contains website files:\n  ${extra.join('\n  ')}`);
  process.exit(1);
}
console.log('The Mac app’s build has none of the website’s pages or files.');
