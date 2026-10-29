// Builds the iPhone app for App Store Connect (npm run ios:store): an arm64 release build,
// signed for distribution, exported as an .ipa ready for TestFlight. With an App Store
// Connect API key in the environment, it uploads it too.
//
// Needs Xcode signed in to the team's Apple account (Xcode → Settings → Accounts), or an
// App Store Connect API key (below), so Xcode can make the app's distribution profile for
// io.salem.SequencePhotosMobile; and an "Apple Distribution" certificate in this Mac's
// keychain (Xcode → Settings → Accounts → Manage Certificates → +).
//
// Optional environment:
//   APPLE_DEVELOPMENT_TEAM   the team ID (default: the one on the Apple Distribution certificate)
//   BUILD_NUMBER             CFBundleVersion; must increase with every upload (default: commit count)
//   APP_STORE_API_KEY_ID     an App Store Connect API key (Users and Access → Integrations):
//   APP_STORE_API_ISSUER     with these set, Xcode signs with it and the .ipa is uploaded too.
//   APP_STORE_API_KEY_PATH   The key file is AuthKey_<id>.p8, here or in ~/.appstoreconnect/private_keys/

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const IOS_CONFIG = 'src-tauri/tauri.ios.conf.json';
const BUILD_DIR = 'src-tauri/gen/apple/build/arm64';
const { version } = JSON.parse(readFileSync(IOS_CONFIG, 'utf8'));

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

/** Building for iOS needs Xcode itself, not the Command Line Tools; use Xcode's if those are active. */
function xcode() {
  if (spawnSync('xcodebuild', ['-version']).status === 0) return {};
  const app = '/Applications/Xcode.app/Contents/Developer';
  if (!existsSync(app)) fail('Building for iOS needs Xcode.');
  return { DEVELOPER_DIR: app };
}

/** The team on this Mac's Apple Distribution certificate. */
function teamFromKeychain() {
  const list = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  return list.match(/"Apple Distribution: [^"]+\(([A-Z0-9]{10})\)"/)?.[1] ?? null;
}

const team = process.env.APPLE_DEVELOPMENT_TEAM ?? teamFromKeychain();
if (!team)
  fail(
    'To build for the App Store, this Mac needs an "Apple Distribution" certificate\n' +
      '(Xcode → Settings → Accounts → Manage Certificates → +), or APPLE_DEVELOPMENT_TEAM set.',
  );
const build =
  process.env.BUILD_NUMBER ?? execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();

// Rust is found where rustup installs it even when the shell running this didn't put it on PATH.
const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
if (existsSync(cargoBin)) process.env.PATH = `${cargoBin}:${process.env.PATH}`;

const { APP_STORE_API_KEY_ID: key, APP_STORE_API_ISSUER: issuer, APP_STORE_API_KEY_PATH: keyPath } = process.env;
const env = {
  ...process.env,
  ...xcode(),
  APPLE_DEVELOPMENT_TEAM: team,
  // Tauri hands an API key to Xcode, which then makes the profile without an account signed in.
  ...(key && issuer ? { APPLE_API_KEY: key, APPLE_API_ISSUER: issuer } : {}),
  ...(keyPath ? { APPLE_API_KEY_PATH: keyPath } : {}),
};

console.log(`Building Sequence for iPhone ${version} (${build}) for App Store Connect…`);
const tauri = spawnSync(
  'npx',
  ['tauri', 'ios', 'build', '--export-method', 'app-store-connect', '--build-number', build, '--ci'],
  { stdio: 'inherit', env },
);
if (tauri.status !== 0) fail('The app failed to build. If it was signing, check Xcode → Settings → Accounts.');

const ipa = readdirSync(BUILD_DIR).find((f) => f.endsWith('.ipa'));
if (!ipa) fail(`No .ipa in ${BUILD_DIR}.`);
const path = join(BUILD_DIR, ipa);
console.log(`\nBuilt ${path}`);

if (key && issuer) {
  console.log('Uploading to App Store Connect…');
  const auth = ['--api-key', key, '--api-issuer', issuer, ...(keyPath ? ['--p8-file-path', keyPath] : [])];
  const upload = spawnSync('xcrun', ['altool', '--upload-app', '-f', path, '-t', 'ios', ...auth], {
    stdio: 'inherit',
    env,
  });
  if (upload.status !== 0) fail('The upload failed.');
  console.log('Uploaded. It shows up in App Store Connect → TestFlight once Apple has processed it.');
} else {
  console.log('To upload it: open it in Transporter, or set APP_STORE_API_KEY_ID and APP_STORE_API_ISSUER.');
}
