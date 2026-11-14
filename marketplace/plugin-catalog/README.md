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

## TryPost

The listing connects to TryPost's own MCP server at `https://app.trypost.it/mcp/trypost`
(<https://docs.trypost.it/ai/introduction>). It answers 401 with a `Bearer` challenge. The
protected-resource metadata names `https://app.trypost.it`, which has dynamic client registration
with S256, so the user signs in through the browser and types no key. On the consent screen, the
user chooses the workspace that the connection can use. One connection works on one workspace.

TryPost Cloud needs an active subscription for MCP. A self-hosted TryPost does not.

Troubleshooting:

- The server replies 402 with "Active subscription required.": the TryPost Cloud account of the
  workspace has no active subscription. Subscribe in TryPost, then test the server again.
- The agent does not see the posts or channels that the user expects: the connection uses another
  workspace. In the MCP servers settings, select Sign out on the TryPost server, then Sign in, and
  choose the correct workspace.
- A self-hosted TryPost: add an MCP server with the address of the instance followed by
  `/mcp/trypost`, in the MCP servers settings, and select Sign in.

## Adobe Analytics

The listing connects to Adobe's own MCP server at `https://aa-mcp.adobe.io/mcp`
(<https://developer.adobe.com/analytics-mcp/docs/aa/>). It answers 401 with a `Bearer` challenge. The
authorization server metadata names Adobe IMS (`ims-na1.adobelogin.com`) and has dynamic client
registration with S256, so the user signs in with an Adobe ID through the browser and types no key.
A registration with the loopback address gets the `offline_access` scope and the `refresh_token`
grant (checked 2026-11-13). A user whose Adobe ID is in more than one organization selects one at
sign-in.

The metadata does not list `offline_access` in `scopes_supported`, so OpenBot does not ask for it
(`withOfflineAccess` in `src/backend/mcp-oauth-provider.ts`). Adobe's authorize endpoint accepts the
request with or without that scope. Not confirmed with an Adobe account: whether the token answer
then has a refresh token. Without one, the user signs in again when the access token expires.

An Adobe administrator must add `MCP Read-only Access` or `MCP Full Access` to a product profile of
the user, in Admin Console > Products > Adobe Analytics > Permissions > Analytics Tools. A product
administrator always has full access. Full access adds `upsertSegment`, `upsertCalculatedMetric`,
`createDateRange` and `upsertProject`. The server has no delete tools.

Adobe's server-to-server path (`client_credentials`) is not in the listing. It needs four headers
(`Authorization`, `x-api-key`, `x-gw-ims-org-id`, `x-global-company-id`), a key flow has at most two
fields, and its access token expires, so a saved token stops working.

Customer Journey Analytics has a separate server, `https://cja-mcp.adobe.io/mcp`, with the same
sign-in. It has no listing; the user adds it in the MCP servers settings and selects Sign in.

Troubleshooting:

- The sign-in succeeds but the tools are refused: the account has no MCP permission item. Ask the
  Adobe administrator, then sign out and sign in again; Adobe says a change can take some time.
- The agent sees the wrong report suites: the connection uses another organization or login company.
  Sign out, sign in, and select the correct organization. `findCompanies` lists the login companies.

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

## Sunra

The listing connects to Sunra's hosted MCP server at `https://mcp.sunra.ai`
(<https://mcp.sunra.ai/.well-known/oauth-authorization-server>). The server uses OAuth 2.1 with
dynamic client registration and client ID metadata documents, PKCE S256, refresh tokens and the
scope `mcp`, so the user signs in through the browser and types no key. The connection pays from the
Sunra workspace that the user selected at sign-in: Personal or a Team. `select_workspace` changes
it; an agent must not change it without a request from the user.

A create tool (`create_image`, `create_video`, `create_audio`, `create_model3d`) without
`auto_confirm` only stages the work and returns a quote with `estimated_credits` and a `plan_id`.
`confirm_execution`, or `auto_confirm` on the create call, spends the credits. The agent reads the
result with `get_job`.

Troubleshooting:

- "Insufficient credits": the selected workspace has too few credits. Sunra gives free daily
  credits; top-ups are only for subscribers. See <https://sunra.ai/pricing>.
- A video generation fails: video models need an active Sunra plan.

## AppSignal

The listing connects to AppSignal's own MCP server at `https://appsignal.com/api/mcp`
(<https://docs.appsignal.com/mcp.html>). It answers 401 with a `Bearer` challenge. The
authorization server (`https://appsignal.com`) has dynamic client registration with S256, so the
user signs in through the browser and types no key (checked 2026-11-14). The resource metadata asks
for `app:read app:write`.

A sign-in gives all read and write tools of the account. AppSignal's MCP token can limit the
applications and the tools, but the listing does not use it: the token is a second way in, and a
listing has one flow. A user who wants that limit adds an MCP server with the same address and an
`Authorization: Bearer <token>` header in the MCP servers settings.

Not confirmed with an AppSignal account: whether the token answer has a refresh token. Without one,
the user signs in again when the access token expires.

Troubleshooting:

- A tool returns no data: the app does not send that data to AppSignal. For example,
  `get_log_lines` is empty when the app sends no logs.

## Cloud 66

The listing connects to Cloud 66's own MCP server at `https://app.cloud66.com/mcp`
(<https://help.cloud66.com/sites/mcp/what-is-the-mcp-server/>). It answers 401 with a `Bearer`
challenge. The authorization server (`https://app.cloud66.com/mcp/oauth`) has dynamic client
registration with S256 (checked 2026-11-14). The resource metadata lists each scope, so the
authorization request asks for all of them, and the user can clear some on the consent page. Tools
outside the granted scopes are hidden. A scope cannot give more than the user's Cloud 66 role.

The access token is valid for 7 days. A second sign-in of the same client revokes the first token.
Each user can have 10 MCP sessions at a time.

To delete an application or a deployment profile, or to add a cloud, Cloud 66 sends an elicitation
over the open session. The agent shows a one-time Cloud 66 link, and the user confirms on that page
in the browser (with 2FA for a delete). Cloud 66 does not document the elicitation mode. OpenBot
shows a `form` request as a question card in the chat and declines a `url` request
(`mcpElicitationQuestions` in `src/backend/agent/prompts.ts`). Cloud 66 supports only MCP
`2025-06-18`, which has no `url` mode, so the request is probably a `form`. Not confirmed with a
Cloud 66 account. A chat in Slack, Discord or Telegram cancels the request. When the request fails,
the tool fails with "this tool requires an MCP client with elicitation support" or a decline; do
the action in the Cloud 66 dashboard. The other tools do not need it.

Troubleshooting:

- `Missing required argument: account_id`: each tool except `list_accounts` needs an account.
  Ask the agent to list the accounts first.
- `Token missing scope: <resource>:<action>`: the user cleared that permission on the consent page.
  Sign out, sign in, and select it.
- HTTP 429 when the connection opens: the user has 10 open sessions. Wait for old sessions to end.
- Deleting needs 2FA on the Cloud 66 account.
