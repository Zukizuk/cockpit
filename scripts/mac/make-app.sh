#!/bin/bash
# Builds Cockpit.app, the Mac's Start menu entry: an app you open from Launchpad, Spotlight or the Dock, which runs
# open.sh (the server if needed, then Cockpit's window).
#
#   make-app.sh <where/Name.app> <open.sh> [<node>]   an app that runs that open.sh (a clone's, for npm run setup:mac)
#
# <node> is the Node to start the server with when your shell's PATH doesn't have it (nvm, for example, is only set up
# in an interactive shell). An app already at <where/Name.app> is replaced only once the new one is built. The icon
# comes from web/public/icons/icon-512.png.
set -e
app="${1:?usage: make-app.sh <where/Name.app> <open.sh> [<node>]}"
launcher="${2:?usage: make-app.sh <where/Name.app> <open.sh> [<node>]}"
node="${3:-}"
case "$app" in *.app) ;; *) echo "make-app.sh: $app should end in .app" >&2; exit 1 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
xml() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/package.json")"
name="$(basename "$app" .app)"
# a second copy (Cockpit (dev)) is an app of its own to macOS, not the same one twice
id=com.zukizuk.cockpit
slug="$(printf '%s' "$name" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-*//; s/-*$//' | tr 'A-Z' 'a-z')"
[ "$name" = Cockpit ] || id="$id.${slug:-copy}"

# built beside it, then swapped in: a failed build leaves the old app as it was
new="$(mktemp -d "$(dirname "$app")/.Cockpit-building.XXXXXX")"
trap 'rm -rf "$new"' EXIT
mkdir -p "$new/Contents/MacOS" "$new/Contents/Resources/cockpit.iconset"

# the app's program: a script, so the app stays small and always runs the launcher it was made for
{
  echo '#!/bin/bash'
  [ -n "$node" ] && printf 'export COCKPIT_NODE=%q\n' "$node"
  printf 'exec /bin/bash %q\n' "$launcher"
} >"$new/Contents/MacOS/Cockpit"
chmod 755 "$new/Contents/MacOS/Cockpit"

# LSUIElement: the app only opens Cockpit's window and quits, so it doesn't bounce in the Dock or stay in the app switcher
cat >"$new/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$(xml "$name")</string>
  <key>CFBundleDisplayName</key><string>$(xml "$name")</string>
  <key>CFBundleIdentifier</key><string>$id</string>
  <key>CFBundleExecutable</key><string>Cockpit</string>
  <key>CFBundleIconFile</key><string>cockpit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$(xml "$version")</string>
  <key>CFBundleVersion</key><string>$(xml "$version")</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

# the icon: Cockpit's PNG at the sizes macOS wants, made into an .icns with the Mac's own sips and iconutil
set_dir="$new/Contents/Resources/cockpit.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$root/web/public/icons/icon-512.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  [ "$double" -le 512 ] && sips -z "$double" "$double" "$root/web/public/icons/icon-512.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o "$new/Contents/Resources/cockpit.icns"
rm -rf "$set_dir"

# the old app moves aside first and comes back if the new one can't take its place
chmod 755 "$new"
old=""
if [ -e "$app" ]; then old="$new.old" && mv "$app" "$old"; fi
if ! mv "$new" "$app"; then
  [ -n "$old" ] && mv "$old" "$app"
  exit 1
fi
[ -n "$old" ] && rm -rf "$old"
trap - EXIT
# Finder and the Dock show the new icon and name straight away
touch "$app"
