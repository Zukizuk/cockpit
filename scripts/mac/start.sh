#!/bin/bash
# Starts Cockpit's server in the background, if it isn't running already (the Mac's start-hidden.vbs). Cockpit.app
# runs it through open.sh; the login start (install-startup.sh) runs it with --foreground, so the server is the login
# item's own process. An installed copy brings its own Node (Contents/Resources/runtime/node in Cockpit.app); a clone
# uses COCKPIT_NODE (the Node npm run setup:mac found) or the Node your shell finds. Says why and exits 1 if there's none.
root="$(cd "$(dirname "$0")/../.." && pwd)"
port="${COCKPIT_PORT:-4790}"

# Apps opened from Finder, the Dock or at login get a bare PATH: add the one your login shell sets up (Homebrew and
# so on), so Node is found here, and Claude Code and the commands you Run are found by the server. The marker keeps
# anything a profile prints out of it.
login_path="$("${SHELL:-/bin/zsh}" -lc 'printf "\n__cockpit_path__%s" "$PATH"' 2>/dev/null </dev/null | sed -n 's/^__cockpit_path__//p')"
[ -n "$login_path" ] && export PATH="$PATH:$login_path"

node=""
case "$root" in */Contents/Resources/app) node="$(dirname "$root")/runtime/node" ;; esac
[ -x "$node" ] || node="${COCKPIT_NODE:-}"
[ -x "$node" ] || node="$(command -v node)"
if [ -z "$node" ]; then
  echo "Cockpit needs Node 20 or later, and none was found. Install it (nodejs.org or Homebrew), then open Cockpit again." >&2
  exit 1
fi

cd "$root" || exit 1
if [ "${1:-}" = --foreground ]; then exec "$node" server/index.js; fi
# already up: nothing to do (a second copy would notice too, and exit)
curl -fsS -m 1 "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q '"app":"cockpit"' && exit 0
# the server writes its own log (server.log in ~/.cockpit)
nohup "$node" server/index.js >/dev/null 2>&1 &
