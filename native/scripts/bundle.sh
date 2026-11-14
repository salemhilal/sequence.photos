#!/bin/sh
# Builds Sequence.app from the GPUI app: the binary, Info.plist, the icons, and the
# sandbox entitlements, signed so it runs in the App Sandbox like the App Store build.
#
#   native/scripts/bundle.sh                 debug build, this Mac's architecture, ad-hoc signed
#   RELEASE=1 native/scripts/bundle.sh       release build
#   UNIVERSAL=1 RELEASE=1 …                  Apple silicon and Intel
#   SIGN_IDENTITY="Apple Development: …" …   sign with a real identity
#   IDENTIFIER=io.salem.PhotobookSequencer … the shipping identifier (default: the experiment's)
#   ENTITLEMENTS=… PROFILE=…                 the App Store build's (see app-store.sh)
#
# Prints the app's path.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)

identifier=${IDENTIFIER:-io.salem.PhotobookSequencer.gpui}
version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
build=${BUILD_NUMBER:-$(git rev-list --count HEAD)}
profile=debug
flags=""
if [ "${RELEASE:-}" = 1 ]; then profile=release; flags="--release"; fi

if [ "${UNIVERSAL:-}" = 1 ]; then
  cargo build -p sequence-mac $flags --target aarch64-apple-darwin >&2
  cargo build -p sequence-mac $flags --target x86_64-apple-darwin >&2
  out=target/universal/$profile
  mkdir -p "$out"
  lipo -create -output "$out/Sequence" \
    "target/aarch64-apple-darwin/$profile/Sequence" "target/x86_64-apple-darwin/$profile/Sequence"
else
  cargo build -p sequence-mac $flags >&2
  out=target/$profile
fi

app="$out/Sequence.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$out/Sequence" "$app/Contents/MacOS/Sequence"
sed -e "s/__IDENTIFIER__/$identifier/" -e "s/__VERSION__/$version/" -e "s/__BUILD__/$build/" \
  mac/bundle/Info.plist > "$app/Contents/Info.plist"
cp ../src-tauri/icons/icon.icns ../src-tauri/icons/Assets.car "$app/Contents/Resources/"
if [ -n "${PROFILE:-}" ]; then cp "$PROFILE" "$app/Contents/embedded.provisionprofile"; fi

codesign --force --options runtime --timestamp=none \
  --entitlements "${ENTITLEMENTS:-mac/bundle/Entitlements.plist}" \
  --sign "${SIGN_IDENTITY:--}" "$app" >&2
echo "$root/$app"
