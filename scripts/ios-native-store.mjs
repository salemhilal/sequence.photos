// Builds the native iPhone app (ios/) for App Store Connect (npm run ios:native:store): an
// archive, signed for distribution and exported as an .ipa ready for TestFlight. With an App
// Store Connect API key in the environment, or `--upload`, it uploads it too.
//
// Needs Xcode signed in to the team's Apple account (Xcode → Settings → Accounts), or an App
// Store Connect API key (below), so Xcode can make the distribution profile; and xcodegen.
//
// Optional environment:
//   BUILD_NUMBER             CFBundleVersion; must increase with every upload (default: commit count)
//   APP_STORE_API_KEY_ID     an App Store Connect API key (Users and Access → Integrations):
//   APP_STORE_API_ISSUER     with these set, Xcode signs with it and the .ipa is uploaded too.
//   APP_STORE_API_KEY_PATH   The key file is AuthKey_<id>.p8, here or in ~/.appstoreconnect/private_keys/

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const IOS = 'ios';
const WORK = resolve(IOS, 'build/store');
const TEAM = 'S3979WFPKR';

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

const env = { ...process.env, ...xcode() };
const run = (cmd, args, failure) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env, cwd: IOS });
  if (result.status !== 0) fail(failure);
};

const build =
  process.env.BUILD_NUMBER ?? execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
const { APP_STORE_API_KEY_ID: key, APP_STORE_API_ISSUER: issuer } = process.env;
const keyPath =
  process.env.APP_STORE_API_KEY_PATH ??
  (key ? join(homedir(), '.appstoreconnect/private_keys', `AuthKey_${key}.p8`) : undefined);
// Xcode makes the profile with the API key if there is one, else with the signed-in account.
const auth =
  key && issuer
    ? ['-authenticationKeyPath', resolve(keyPath), '-authenticationKeyID', key, '-authenticationKeyIssuerID', issuer]
    : [];

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const archive = join(WORK, 'Sequence.xcarchive');
const exported = join(WORK, 'export');
const options = join(WORK, 'export.plist');

run('xcodegen', ['generate', '--quiet'], 'xcodegen failed (brew install xcodegen).');
console.log(`Archiving Sequence for iPhone, build ${build}…`);
run(
  'xcodebuild',
  [
    'archive',
    '-project',
    'Sequence.xcodeproj',
    '-scheme',
    'Sequence',
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    archive,
    '-allowProvisioningUpdates',
    ...auth,
    `CURRENT_PROJECT_VERSION=${build}`,
    '-quiet',
  ],
  'The archive failed. If it was signing, check Xcode → Settings → Accounts.',
);

const upload = Boolean(key && issuer) || process.argv.includes('--upload');
writeFileSync(
  options,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${TEAM}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>${upload ? 'upload' : 'export'}</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
`,
);
run(
  'xcodebuild',
  [
    '-exportArchive',
    '-archivePath',
    archive,
    '-exportPath',
    exported,
    '-exportOptionsPlist',
    options,
    '-allowProvisioningUpdates',
    ...auth,
    '-quiet',
  ],
  upload ? 'The upload failed.' : 'The export failed.',
);

if (upload) {
  console.log('Uploaded. It shows up in App Store Connect → TestFlight once Apple has processed it.');
} else {
  const ipa = readdirSync(exported).find((f) => f.endsWith('.ipa'));
  console.log(`\nBuilt ${join(IOS, 'build/store/export', ipa ?? '')}`);
  console.log('To upload it: run this with --upload, open it in Transporter, or set the API key above.');
}
