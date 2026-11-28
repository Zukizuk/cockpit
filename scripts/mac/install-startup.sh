#!/bin/bash
# Starts Cockpit's server at login on a Mac (the Mac's install-startup.ps1): a LaunchAgent, the Mac's own way to run
# something when you log in. It runs start.sh --foreground from this copy (with COCKPIT_NODE, when it's set, so the
# same Node is used at login). With --remove, takes it away again. Adding it also starts the server now (if it isn't
# running). Like Windows' login start, a server that stops isn't started again until Cockpit is opened.
label="com.zukizuk.cockpit.server"
plist="$HOME/Library/LaunchAgents/$label.plist"
launchctl="${COCKPIT_LAUNCHCTL:-/bin/launchctl}"
domain="gui/$(id -u)"

if [ "${1:-}" = --remove ]; then
  "$launchctl" bootout "$domain/$label" >/dev/null 2>&1
  if [ -f "$plist" ]; then rm -f "$plist" && echo "Removed the Cockpit login start."; else echo "No Cockpit login start to remove."; fi
  exit 0
fi

xml() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
start="$(cd "$(dirname "$0")" && pwd)/start.sh"
env_node=""
[ -n "${COCKPIT_NODE:-}" ] && env_node="  <key>EnvironmentVariables</key><dict><key>COCKPIT_NODE</key><string>$(xml "$COCKPIT_NODE")</string></dict>"
mkdir -p "$(dirname "$plist")"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml "$start")</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key><true/>
$env_node
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
EOF
# replaces one added before (from this copy or another), then starts it
"$launchctl" bootout "$domain/$label" >/dev/null 2>&1
# (bootout can still be finishing for a moment, so bootstrap gets a few tries)
for try in 1 2 3 4 5; do
  err="$("$launchctl" bootstrap "$domain" "$plist" 2>&1)" && break
  [ "$try" = 5 ] && { echo "Couldn't add the login start ($plist): $err" >&2; exit 1; }
  sleep 0.5
done
echo "Added $plist"
