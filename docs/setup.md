# Setting up a new machine

Most of the work happens elsewhere: Netlify builds and deploys the website, and GitHub
Actions tests the Mac app and uploads it to the App Store. A new machine only needs enough
to run the site and the app locally.

## The website

You need Git and Node 24 (the version in `.nvmrc`; anything from 20.19 works).

```bash
git clone git@github.com:salemhilal/sequence.photos.git
cd sequence.photos
nvm install      # or: brew install node@24
npm install
npm run dev      # → http://localhost:5175 (the landing page; the app is at /app/)
npm test
```

That's all the website needs. The site's domain and App Store link are set in `.env`, which
is checked in.

## The Mac app

On a Mac (macOS 13 or later), you also need:

1. **The Xcode Command Line Tools**, for the compiler and code signing:
   ```bash
   xcode-select --install
   ```
2. **Rust**, from [rustup.rs](https://rustup.rs) (1.90 or later):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   The installer adds `~/.cargo/bin` to your shell's `PATH`; open a new terminal after it
   finishes (`cargo --version` should work). If `npm run app:dev` says it can't find `cargo`,
   add this to `~/.zshrc`:
   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   ```

Then:

```bash
npm run app:dev    # run it, reloading on changes (the first build takes a few minutes)
npm run test:app   # the end-to-end test: open, save, relaunch, and sandboxed
npm run app:build  # a local build → src-tauri/target/release/bundle/macos/
```

Local builds are ad-hoc signed and sandboxed like the App Store's, so they need no Apple
account or certificates.

## Releasing

Nothing to set up. Releases come from GitHub:

- **Website:** every push to `main` deploys to sequence.photos (Netlify). Pull requests get
  a preview deploy.
- **Mac app:** run the **Release** workflow (Actions → Release → Run workflow) with the
  new version, or from the command line:

  ```bash
  gh workflow run release.yml -f version=0.1.2
  ```

  It sets the version everywhere, commits and tags it on `main`, and publishes the GitHub
  release. Then the **App Store** workflow tests the app, builds it, signs it, and uploads
  it to App Store Connect, where you pick the build and submit it for review. Tick _Dry
  run_ to check a version without releasing.

The signing certificates, provisioning profile, and App Store Connect API key live in the
repo's Actions secrets (the workflow's header lists them), not on any machine.

### Building for the App Store locally (optional)

Only needed to upload without GitHub, with `npm run app:store`. It needs:

- **Full Xcode** (from the App Store), for the upload tool. The Command Line Tools aren't
  enough.
- **The Apple Distribution and Mac Installer Distribution certificates** in your keychain.
  Get them from Xcode → Settings → Accounts → Manage Certificates.
- **The app's Mac App Store provisioning profile**, downloaded from developer.apple.com →
  Profiles, saved as `src-tauri/embedded.provisionprofile`. It's kept out of Git.
- **An App Store Connect API key**, to upload as well as build: set
  `APP_STORE_API_KEY_ID`, `APP_STORE_API_ISSUER`, and `APP_STORE_API_KEY_PATH`. Without
  one, it builds the `.pkg` for you to upload with Transporter.

The script says what's missing.
