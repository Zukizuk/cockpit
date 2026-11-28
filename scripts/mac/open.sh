#!/bin/bash
# Opens Cockpit (the Mac's open.vbs): starts its server if it isn't running, waits until it answers, then opens Cockpit
# in its own window, an app window of Google Chrome or Microsoft Edge (a tab of your default browser if neither is
# installed). Cockpit.app runs this. If the server can't start, it says so.
here="$(cd "$(dirname "$0")" && pwd)"
port="${COCKPIT_PORT:-4790}"
url="http://127.0.0.1:$port/"
up() { curl -fsS -m 1 "${url}api/health" 2>/dev/null | grep -q '"app":"cockpit"'; }
alert() {
  /usr/bin/osascript -e 'on run argv' -e 'display alert "Cockpit couldn’t start." message (item 1 of argv) as warning' \
    -e 'end run' "$1" >/dev/null 2>&1
  exit 1
}

if ! up; then
  # start.sh says why when it can't start the server (no Node, for one)
  why="$(/bin/bash "$here/start.sh" 2>&1 >/dev/null)" || alert "${why:-Its server didn’t start.}"
  for _ in $(seq 60); do
    sleep 0.25
    up && break
  done
  # most often another program already uses Cockpit's port; the log says what happened
  up || alert "Another program may be using port $port. The details are in ${COCKPIT_DATA:-${COCKPIT_HOME:-$HOME}/.cockpit}/server.log"
fi

for browser in "Google Chrome" "Microsoft Edge"; do
  for dir in /Applications "$HOME/Applications"; do
    # -n: when the browser is already open, its running copy still gets --app and opens the window
    [ -d "$dir/$browser.app" ] && exec /usr/bin/open -na "$dir/$browser.app" --args --app="$url"
  done
done
exec /usr/bin/open "$url"
