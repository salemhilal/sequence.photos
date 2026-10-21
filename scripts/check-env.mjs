// Fails if an env file could leak a secret: a committed one that sets anything but public
// VITE_ values (they ship in the website and the Mac app), or one that's neither committed
// nor git-ignored, so `git add -A` would pick it up. Secrets go in files named to be
// git-ignored (.env.local, .env.*.local, .dev.vars). Prints names, never values.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const SECRETISH = /SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|(^|_)KEY($|_)/;
const envFile = (f) => /^\.env($|\.)|^\.dev\.vars/.test(basename(f));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(envFile);

const unignored = git('ls-files', '--others', '--exclude-standard')
  .filter((f) => !f.endsWith('.example'))
  .map((f) => `${f}: isn't committed or git-ignored; rename it .env.local if it holds secrets`);

const committed = git('ls-files').flatMap((file) => {
  if (file.endsWith('.example') || !existsSync(file)) return [];
  if (/\.local$|^\.dev\.vars/.test(basename(file))) return [`${file}: is a secrets file, and shouldn't be committed`];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(export\s+)?[A-Za-z_]\w*\s*=/.test(line))
    .map(
      (line) =>
        line
          .replace(/^export\s+/, '')
          .split('=')[0]
          ?.trim() ?? '',
    )
    .flatMap((name) => {
      if (!name.startsWith('VITE_')) return [`${file}: ${name} isn't a public VITE_ value`];
      if (SECRETISH.test(name.slice(5))) return [`${file}: ${name} looks like a secret`];
      return [];
    });
});

const problems = [...unignored, ...committed];
if (problems.length) {
  console.error(`Env files that could leak a secret:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
