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
- When a new version moves an `http` server to a different address, list the
  earlier address in `earlierUrls`. A row with the catalog name on one of these
  hosts, or on a subdomain, is then still the app's row. Composio lists
  `https://composio.dev/`, because versions 1.0.0 and 1.1.0 saved the user's
  own link on any Composio host.
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

## GitLab

The listing connects to GitLab's own MCP server at `https://gitlab.com/api/v4/mcp`
(<https://docs.gitlab.com/user/model_context_protocol/mcp_server/>). The server
uses OAuth with dynamic client registration and the `mcp` scope, so the user
signs in through the browser and types no token.

A listing cannot ask for a server address and a browser sign-in together: a
`url` field exists only in a `key` flow. GitLab refuses classic personal access
tokens on this server, so a key flow would need a fine-grained token. For a
self-hosted GitLab, the user adds `https://<gitlab-host>/api/v4/mcp` in the
server's MCP servers settings and selects Sign in.

Troubleshooting:

- A self-hosted server refuses the connection or has no MCP endpoint: an admin
  must allow access to the MCP server for the instance. The server is GA from
  GitLab 19.5.

## Omnisend

The listing connects to Omnisend's own MCP server at `https://mcp.omnisend.com/mcp`
(<https://api-docs.omnisend.com/reference/mcp-server>). The server uses OAuth with
dynamic client registration, so the user signs in through the browser and types
no key. The user selects the access level on Omnisend's consent screen. The
account needs the Owner, Admin, Manager or Partner role.

The server shows four tools: `search`, `tool_schema`, `tool_documentation` and
`execute`. The agent finds an Omnisend operation with `search` and runs it with
`execute`. With write access, the operations include sending and deleting
campaigns, automations and segments.

Troubleshooting:

- A write fails with "Permission denied": the user granted read-only access.
  Disconnect and sign in again with write access.
- The account has more than one brand: one connection works on one brand.
  Omnisend's guide adds a separate server for each brand with a `?brand=` query
  parameter; add it in the MCP servers settings and select Sign in.

## Honcho

The listing connects to Honcho's hosted MCP server at `https://mcp.honcho.dev`
(<https://honcho.dev/docs/v3/guides/integrations/mcp>). It answers 401 with a
`Bearer` challenge. The protected-resource metadata names
`https://api.honcho.dev`, which has dynamic client registration with S256, so the
user signs in through the browser. Honcho's documentation describes only keys, so
the listing keeps a key flow: `Authorization: Bearer hch-…` from
<https://app.honcho.dev>.

The server also reads an optional `X-Honcho-Workspace-ID` header. The listing
does not ask for it: the sign-in flow cannot send it, and the connect form shows
every key field as a password. Each workspace tool takes a `workspace_id`, and
the agent can find one with `list_workspaces`.

A self-hosted Honcho: run the `mcp` package of
<https://github.com/plastic-labs/honcho> with `HONCHO_API_URL` set to the
instance, and add `http://127.0.0.1:3000/mcp` in the MCP servers settings.

## Hindsight

The listing connects to the multi-bank address of Hindsight Cloud,
`https://api.hindsight.vectorize.io/mcp`, and not to `/mcp/{bank_id}`. One
address serves every user, and the agent gets `list_banks`, `create_bank` and
`get_bank_stats`. Each tool takes an optional `bank_id`; with none, Hindsight
uses the bank `default` and makes it on first use.

The address answers 401 with a `Bearer` challenge and has dynamic client
registration with S256, so the user signs in through the browser and chooses an
organization. The server has no revocation endpoint. The key flow sends
`Authorization: Bearer hsk_…` from the Connect page of
<https://ui.hindsight.vectorize.io>. The optional `X-Bank-Id` header is not in
the listing, for the same reasons as the Honcho workspace header.

A self-hosted Hindsight serves the same tools at `http://localhost:8888/mcp`,
with no key by default. Add it in the MCP servers settings.

## Postiz

The listing connects to Postiz's own MCP server at
`https://mcp.postiz.com/mcp-oauth-dynamic`. Postiz's documentation
(<https://docs.postiz.com/mcp/setup>) names only `https://mcp.postiz.com/mcp`,
which takes an API key and has no sign-in. The `-oauth-dynamic` path is the one
that Postiz's source names for clients that register themselves
(`libraries/nestjs-libraries/src/chat/start.mcp.ts` in
<https://github.com/gitroomhq/postiz-app>). It answers 401 with a `Bearer`
challenge and has dynamic client registration with S256, so the user signs in
through the browser. Postiz access tokens do not expire, and the server lists no
`refresh_token` grant.

The same path also takes the API key from Settings › Developers in Postiz as
`Authorization: Bearer <key>`, so the listing keeps a key flow as a second way
in. All Postiz cloud plans include API access; there is no free plan.

`schedulePostTool` takes `type` `draft`, `schedule` or `now`; `now` publishes
immediately.

Troubleshooting:

- "Invalid API Key or OAuth token": the key is wrong or was rotated. Copy it
  again from Settings › Developers, or sign in instead.
- A self-hosted Postiz: add an MCP server with the backend address of the
  instance (`NEXT_PUBLIC_BACKEND_URL`) followed by `/mcp`, and the same
  `Authorization` header, in the MCP servers settings.

## ElevenLabs

The listing connects to ElevenLabs' hosted MCP server at `https://api.elevenlabs.io/v1/mcp`
(<https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp>). ElevenLabs deprecated its local
server. The authorization server has no client registration. It reads OpenBot's client metadata
document, `https://openbot.run/oauth/mcp-client.json`, so the user signs in through the browser and
types no key. Generated audio comes back as a short-lived download link.

The data residency servers (`api.eu.residency.elevenlabs.io`, `api.in.residency.elevenlabs.io`,
`api.sg.residency.elevenlabs.io`) use separate accounts. The user adds `https://<host>/v1/mcp` in
the server's MCP servers settings and selects Sign in.

Troubleshooting:

- The sign-in page refuses the redirect address: another program uses port 28417, so OpenBot
  listens on another port that the document does not list. Close that program and restart OpenBot.
