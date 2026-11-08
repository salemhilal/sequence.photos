#!/bin/sh
# Builds the GPUI app's Mac App Store package, as scripts/app-store.mjs does for the Tauri
# app: universal, sandboxed, signed with the App Store identity and the app's provisioning
# profile, in a signed installer package. Then, with an App Store Connect API key in the
# environment, checks it with Apple (VALIDATE=1, the default) or uploads it (UPLOAD=1).
#
# Needs the same certificates and profile as the Tauri app's build:
#   PROFILE   the Mac App Store profile (default: src-tauri/embedded.provisionprofile)
#   IDENTIFIER          default io.salem.PhotobookSequencer (the profile's)
#   BUILD_NUMBER        CFBundleVersion (default: commit count)
#   APP_STORE_API_KEY_ID, APP_STORE_API_ISSUER, APP_STORE_API_KEY_PATH (optional)
set -eu
cd "$(dirname "$0")/.."

identity() {
  security find-identity -v | sed -n "s/.*\"\($1: [^\"]*\)\".*/\1/p" | head -1
}
app_identity=$(identity "Apple Distribution")
[ -n "$app_identity" ] || app_identity=$(identity "3rd Party Mac Developer Application")
installer_identity=$(identity "3rd Party Mac Developer Installer")
[ -n "$installer_identity" ] || installer_identity=$(identity "Mac Installer Distribution")
profile=${PROFILE:-../src-tauri/embedded.provisionprofile}
identifier=${IDENTIFIER:-io.salem.PhotobookSequencer}
[ -n "$app_identity" ] || { echo "Needs an Apple Distribution certificate." >&2; exit 1; }
[ -n "$installer_identity" ] || { echo "Needs a Mac Installer Distribution certificate." >&2; exit 1; }
[ -f "$profile" ] || { echo "Needs the Mac App Store provisioning profile at $profile." >&2; exit 1; }
team=$(echo "$app_identity" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The sandbox entitlements, plus the identifiers the App Store requires alongside the profile.
sed "s|</dict>|  <key>com.apple.application-identifier</key>\\
  <string>$team.$identifier</string>\\
  <key>com.apple.developer.team-identifier</key>\\
  <string>$team</string>\\
</dict>|" mac/bundle/Entitlements.plist > "$work/AppStore.entitlements"

app=$(UNIVERSAL=1 RELEASE=1 IDENTIFIER=$identifier PROFILE=$profile SIGN_IDENTITY=$app_identity \
  ENTITLEMENTS="$work/AppStore.entitlements" scripts/bundle.sh)
codesign --verify --deep --strict "$app"

version=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$app/Contents/Info.plist")
build=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$app/Contents/Info.plist")
pkg="target/Sequence $version ($build).pkg"
productbuild --sign "$installer_identity" --component "$app" /Applications "$pkg"
echo "Built $pkg"

if [ -n "${APP_STORE_API_KEY_ID:-}" ] && [ -n "${APP_STORE_API_ISSUER:-}" ]; then
  set -- --api-key "$APP_STORE_API_KEY_ID" --api-issuer "$APP_STORE_API_ISSUER"
  if [ -n "${APP_STORE_API_KEY_PATH:-}" ]; then set -- "$@" --p8-file-path "$APP_STORE_API_KEY_PATH"; fi
  if [ "${UPLOAD:-}" = 1 ]; then
    xcrun altool --upload-package "$pkg" -t macos "$@"
  else
    xcrun altool --validate-app -f "$pkg" -t macos "$@"
  fi
else
  echo "To check it with Apple, set APP_STORE_API_KEY_ID and APP_STORE_API_ISSUER (or open it in Transporter)."
fi
