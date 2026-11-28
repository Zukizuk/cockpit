#!/bin/bash
# For working on Cockpit from a clone on a Mac (`npm run setup:mac`, after `npm install`): runs this copy the way an
# installed one runs, with the Node your shell finds now (kept, so Cockpit.app and the login start use it too).
#   - Cockpit.app in ~/Applications (open it from Launchpad or Spotlight, or keep it in the Dock)
#   - the server at login
#   - optionally connects Claude Code to this copy's MCP server, and lists what each turn makes under Outputs
# Undo with: scripts/mac/install-startup.sh --remove, and move ~/Applications/Cockpit.app to the Bin.
# --claude yes|no answers the Claude Code questions up front.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
claude_answer=ask
[ "${1:-}" = --claude ] && claude_answer="${2:-ask}"

# Cockpit.app; an installed Cockpit keeps its own, and this one is called Cockpit (dev)
apps="$HOME/Applications"
app="$apps/Cockpit.app"
ours="exec /bin/bash $(printf %q "$here/open.sh")"
if [ -d "$app" ] && ! grep -qxF "$ours" "$app/Contents/MacOS/Cockpit" 2>/dev/null; then app="$apps/Cockpit (dev).app"; fi
# nvm and the like set Node up only in an interactive shell, which the Dock and the login start don't have
export COCKPIT_NODE="$(command -v node || true)"
mkdir -p "$apps"
/bin/bash "$here/make-app.sh" "$app" "$here/open.sh" "$COCKPIT_NODE"
echo "  Added $(basename "$app" .app) to Applications (open it from Launchpad or Spotlight, or keep it in the Dock)"

/bin/bash "$here/install-startup.sh" >/dev/null
echo "  The server starts at login"

ask() { # question, default (y or n) -> yes if the answer is yes
  local answer
  read -r -p "$1" answer || answer=""
  if [ -z "$answer" ]; then [ "$2" = y ]; else [[ "$answer" =~ ^[yY] ]]; fi
}

if command -v claude >/dev/null && [ "$claude_answer" != no ]; then
  if [ "$claude_answer" = yes ] || ask '  Connect Claude Code to this copy (the show and snippet tools)? [Y/n] ' y; then
    claude mcp remove --scope user cockpit >/dev/null 2>&1 || true
    claude mcp add --scope user cockpit -- "$(command -v node)" "$repo/server/mcp.js"
  fi
  # the Outputs list: a hook that lists what each turn made (skip it if a Claude Code mod already feeds Outputs)
  if [ -d "$HOME/.claude/mods/deliverables-tray" ]; then
    question='  A Claude Code mod already feeds Outputs here. Add Cockpit'"'"'s Outputs hook too? [y/N] '; default=n
  else
    question='  Also list what each Claude turn makes under Outputs? [Y/n] '; default=y
  fi
  if [ "$claude_answer" = yes ] || ask "$question" "$default"; then
    node "$repo/scripts/claude-setup.mjs" add-hook --node "$(command -v node)"
  fi
fi

echo
echo "Done. Open Cockpit from Launchpad or Spotlight. After changing web/, run npm run build."
