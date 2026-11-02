# Plugin catalog source

For a worked example and the sign-in on a joined server, read
[Integrations and sign-in](../../docs/architecture/integrations.md#add-an-application).

One developer bundle per directory: `plugins/<slug>/plugin.json`.
`catalog.json` sets the order and the featured flags.
`scripts/build-plugin-catalog.ts` validates the source and writes three
generated outputs; never edit those by hand:

- `src/renderer/src/features/settings/marketplace-plugin-catalog.ts` (Apps tab)
- `apps/auth-api/src/lib/plugin-catalog.generated.ts` (Worker JSON routes)
- `resources/plugin-catalog/` (offline snapshot shipped with the app)

```sh
bun run marketplace:build:plugins
bun run marketplace:build:plugins -- --check
```

Rules for a new entry:

- One app per plugin. Skills stay `[]` until pinned skill versions exist.
- No secret values anywhere in this directory. Auth declares where a
  credential goes (`header` for http, `env` for stdio); the user types the
  value in the connect dialog.
- `http` servers take a `url`. `stdio` servers take a `command` and `args`.
  No `workingDirectory`: the provider drops such servers.
- A `command` can start with `~/` to name a program that a desktop app installs
  in the home folder, as the Paper listing does. OpenBot expands `~` on the
  computer that runs the server, before any provider starts it.
- Names must pass `mcpConfigErrors` and must not be reserved (`openbot`).
- OAuth-only vendors install as a plain `http` server with a `link` flow, the
  same shape the Canva listing uses. OpenBot signs in itself: the main process
  holds the MCP OAuth client, keeps the tokens in encrypted storage, and adds
  the `Authorization` header at hand-off. No bridge program is installed, and
  no listing may name one.

## Paper

Paper Desktop installs its CLI at `~/.paper/bin/paper`. `paper mcp` is a stdio
relay to the file that is open in Paper Desktop. Paper also has an http address,
`http://127.0.0.1:29979/mcp`, but its documentation calls that address legacy,
and a listing must use https. The listing needs no key.

Troubleshooting:

- "Command not found: ~/.paper/bin/paper": install Paper Desktop from
  <https://paper.design/downloads> and open it once.
- The tools see no file, or the wrong file: open the file in Paper Desktop.
  The server works on the file that is open.
- A long session calls tools that do not exist: start a new thread. Paper
  gives this advice in <https://paper.design/docs/mcp>.

## Obsidian

The listing runs `npx -y obsidian-mcp-server@3.7.2`
(<https://github.com/cyanheads/obsidian-mcp-server>). A third party publishes
this package and it gets write access to the vault, so the listing names one
version. Move it only in a reviewed commit, after you check that the release
keeps `OBSIDIAN_API_KEY` and the `http://127.0.0.1:27123` default. The server talks to the
Local REST API community plugin in the Obsidian app
(<https://github.com/coddingtonbear/obsidian-local-rest-api>). The user types the
plugin's API key in the connect dialog, and OpenBot gives it to the server as
`OBSIDIAN_API_KEY`.

The server uses `http://127.0.0.1:27123` by default. A listing cannot set other
environment values, so the user turns on the plugin's HTTP server:

1. In Obsidian, install and enable the Local REST API plugin (version 4 or later).
2. Open Settings > Local REST API. Copy the API key.
3. Turn on "Enable non-encrypted (HTTP) server". Keep the port at 27123.
4. Keep Obsidian open while agents use the vault.

Troubleshooting:

- The connection is refused: Obsidian is closed, or the HTTP server is off.
- The server replies 401: the API key is wrong. Copy it again from the plugin settings.

## Apple apps

The listing starts the community server `mcp-icloud`
(<https://github.com/MrGo2/icloud-mcp>, MIT) through `npx`. The version is
pinned because the server can read and send mail and iMessages. To update it,
review the upstream changes, change the version in `args`, and increase the
listing `version`. The server has no read-only mode and no setting that limits
it to some apps.

The listing uses local mode only: the server controls the apps on this Mac
through AppleScript and needs no key. Its cloud mode needs
`USE_LOCAL_MODE=false`, and a listing cannot set a fixed environment value.

The app lists `macAutomation`: the Apple apps that the server drives. On a Mac
that runs the server, the listing page shows a switch, on by default, that asks
macOS for each app right after the install, and later an "Ask for access"
button. OpenBot sends one harmless Apple Event (`count windows`) to each app, so
macOS shows its Automation prompt then and not during an agent's task. An app
that the request opened is quit again. macOS does not ask again for an app that
the user refused.

Troubleshooting:

- An error `-1743` ("not authorized to send Apple events"): the user refused
  the Automation prompt. Turn OpenBot on for the app in System Settings ›
  Privacy & Security › Automation, or run `tccutil reset AppleEvents` to get
  the prompts again.
- Mail or Calendar tools time out: AppleScript is slow on large mailboxes and
  on many subscribed calendars. Ask for one folder and a smaller count.
