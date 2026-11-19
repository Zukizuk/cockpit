# Contributing to Cockpit

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the shape of it.
- Cockpit aims to stay small and calm. A change that adds a setting, a panel or a paragraph of instructions needs a
  good reason; a change that removes one is usually welcome.

## Setting up

See [Develop](README.md#develop) in the README. In short: Node 20+, Windows, `npm install`, then `npm start`.
Work against a second server with its own folders (`COCKPIT_PORT`, `COCKPIT_HOME`, `COCKPIT_DATA`) so your own
board and notes stay out of it.

## Making a change

- Keep to the style around you: plain names, short functions, a one-line comment saying *why* where it isn't
  obvious.
- The server has no framework and few dependencies. Prefer Node's own modules.
- UI: dark, minimal, no purple or blue "AI" gradients. Nothing bigger than its content, no instruction
  paragraphs, short placeholders. Every board action needs a keyboard way and a mouse way.
- Never bind something that moves or hides cards to a bare letter key: stray typing can set it off.
- Add or update tests in `test/` for server behaviour.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under today's date (New, Improved or Fixed, in plain words). The app
  shows it as "What's new".

## Checks

```powershell
npm test
```

```powershell
npm run typecheck
```

```powershell
npm run build
```

CI runs the same on every pull request.

## Pull requests

- One change per pull request, with a short description of what and why, and a screenshot for anything visible.
- By contributing, you agree your work is released under the [MIT license](LICENSE).

## Releasing (maintainers)

1. Update `version` in `package.json` and the CHANGELOG.
2. Tag it: `git tag v0.2.0` and push the tag. The release workflow builds the zip and attaches it to a GitHub
   release.
