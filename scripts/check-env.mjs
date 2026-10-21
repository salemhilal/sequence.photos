// Fails if a committed env file could hold a secret. Committed .env files ship in the
// website and the Mac app, so they may only set public VITE_ values; secrets go in files
// named to be git-ignored (.env.local, .env.*.local, .dev.vars). Prints names, never values.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const SECRETISH = /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|(^|_)KEY($|_)/;
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /^\.env|^\.dev\.vars/.test(basename(f)) && !f.endsWith('.example'));

const problems = files.flatMap((file) => {
  if (/\.local$|^\.dev\.vars/.test(basename(file))) return [`${file}: is a secrets file, and shouldn't be committed`];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(
      (line) =>
        line
          .split('=')[0]
          ?.replace(/^export\s+/, '')
          .trim() ?? '',
    )
    .flatMap((name) => {
      if (!name.startsWith('VITE_')) return [`${file}: ${name} isn't a public VITE_ value`];
      if (SECRETISH.test(name.slice(5))) return [`${file}: ${name} looks like a secret`];
      return [];
    });
});

if (problems.length) {
  console.error(`Committed env files are public; put secrets in .env.local:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
