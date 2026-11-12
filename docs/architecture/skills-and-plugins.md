# Skills and plugins

To add a Marketplace application, and for how its browser sign-in works on a joined server, read
[Integrations and sign-in](integrations.md#add-an-application).

## Skill folders and MCP configuration

A skill follows the [Agent Skills specification](https://agentskills.io/specification): a folder
`<name>/` with a `SKILL.md` file. The YAML frontmatter has `name`, which is the folder name, and a
`description` of 1 to 1024 characters. Each provider CLI finds skills in its own folders:

| Folder | Written by | Read by |
| --- | --- | --- |
| `<workspace>/.agents/skills/` | OpenBot, the user, the agent | Codex, Grok, OpenCode, Gemini, Cursor, Cline, Pi, Muse, custom agents |
| `<workspace>/.claude/skills/` | OpenBot, the user, the agent | Claude Code, OpenCode, Cursor |
| `<workspace>/.opencode/skills/` | the user, the agent | OpenCode |
| `<workspace>/.gemini/skills/` | the user, the agent | Gemini |
| `<workspace>/.cursor/skills/` | the user, the agent | Cursor |
| `<workspace>/.cline/skills/`, `<workspace>/.clinerules/skills/` | the user, the agent | Cline |
| `~/.agents/skills/` | the user | Codex, Grok, OpenCode, Cursor, Cline, Pi; Claude through OpenBot (see below) |
| `~/.claude/skills/` | the user | Claude Code, OpenCode, Grok, Cursor |
| `~/.codex/skills/`, `~/.config/opencode/skills/` | the user | Codex, OpenCode |

A confined agent (Grok, OpenCode, Gemini, Cursor, Cline, Pi, Muse or a custom agent, not in Full access) cannot write the workspace
skill folders: `src/backend/process-confinement.ts` protects them as project settings.

OpenBot writes each skill that it installs to both `.agents/skills/<slug>` and
`.claude/skills/<slug>`, because Claude Code does not read `.agents/skills`. It copies the files and
does not make links. `.openbot/skills-lock.json` in the workspace records the file hashes, and
`.openbot/skills-disabled/` holds disabled skills. A bundled skill has an `.openbot-managed.json`
marker.

`src/main/skill-folder-discovery.ts` lists all other skills in the seven workspace folders as
`workspace` skills. The list is read-only: OpenBot never writes, moves or deletes these folders, and
they do not count toward the agent's skill limit. A folder without `SKILL.md` is not a skill. A
skill gets a `problem` when its `SKILL.md` does not follow the specification, or when it is in a
folder that the agent's provider does not read. An agent keeps its workspace when its provider
changes, so a skill in `.agents/skills` stops working after a change to Claude Code. A skill with a
problem is not offered as a chat tag.

OpenBot does not show the home-directory folders in the Skills panel. They hold the host user's
skills, which are the same for every agent, and each provider CLI changes its home-folder rules
without notice. `~/.agents/skills` is the one exception, because it is the folder that the Agent
Skills tools share, so every provider gets it. `src/backend/home-skills.ts` reads it and never writes
to it; it lists each folder with a valid `SKILL.md`, at most 200. `homeSkills` in the provider
descriptor says how each CLI gets these skills:

- `native`: the CLI reads the folder by itself. OpenBot gives it nothing.
- `plugin` (Claude Code): `claudeHomeSkillPlugin` (`src/backend/claude-workspace-sandbox.ts`) makes a
  plugin named `agents` in the provider state folder, with one link for each skill, and each session
  gets it. A skill whose folder name is also in `$CLAUDE_CONFIG_DIR/skills` (else `~/.claude/skills`)
  or in `.claude/skills` of the workspace is left out, because `npx skills` links a skill into both
  folders. Each set of skills has its own folder, named by its hash and never changed, so a running
  query keeps its links. Claude lists a skill as `agents:<name>`.
- `instructions` (Antigravity, Muse, custom ACP agents): these CLIs do not read the folder and have no
  option for one. `ThreadLifecycle` gives the developer instructions a list of the skills, at most
  100, with the first 300 characters of each description and the path of its `SKILL.md`, and the
  model reads the file when a task matches. A skill whose folder name is in a workspace skill folder
  of the provider is left out. Whether the model uses a skill depends on the model.

The `$` list (`listInstalledForChatTags`) adds these skills after the others, with the id
`home:<slug>` and the existing `workspace` origin, so older clients decode them. A slug that the list
already has is left out. The desktop read-only Skills view reads the same route and leaves out the
`home:` ids (`isHomeSkillId`), and so does the analytics skill count. The phone shows them in agent
info with their `~/.agents/skills/<slug>` location. The provider text of a `home:<slug>` tag names the skill's `SKILL.md`
(`displayMessageReferences`); a person, and the released Team API adapters, see the name alone.

In a channel, the `$` list holds the skills of each agent in the channel, one entry for each skill id
(`src/renderer/src/features/conversation/stores/skills-store.ts`). A tag reaches each agent by its
name, so an agent without that skill reads the name only. When the list of one agent fails, the list
shows the skills that loaded and tries again after a reconnect.

MCP servers do not use folders. `projection_mcp_servers` in SQLite is the source of truth for the
whole computer. No shared MCP file format exists: Claude Code reads `.mcp.json` and
`~/.claude.json`, Codex reads `config.toml`, OpenCode reads `opencode.json`, and Cursor, Cline and
Gemini CLI read their own folders. OpenBot writes none of these files. It gives the servers to each
provider when the session starts. Claude starts with `strictMcpConfig`, so it ignores `.mcp.json`
and its user settings (see `plans/003-mcp-works-on-a-clean-machine.md`). The panel masks header and
environment values, `src/backend/mcp-redaction.ts` removes them from logs, and OAuth tokens are in
`safeStorage`.

The 1Password connector is built in and has no SQLite row. `src/main/onepassword-connector-service.ts`
runs the user's `op` CLI once to create the vault "Shared with OpenBot" and a `read_items` service
account, or takes a pasted service account token. Before Connect, the page shows three setup steps
that `checkSetup()` reads: a CLI of 2.18 or later (the user's own on `PATH`, else the copy that
`src/main/onepassword-cli-installer.ts` downloads, with a SHA-256 pinned per target, into
`<userData>/provider-state/1password-cli`), the 1Password app's CLI integration (`op account list`
answers at least one account), and Connect. The service keeps only the token in
`openbot-onepassword-connector-v1.json`, encrypted with `safeStorage`. It reads the vault with
`@1password/sdk` and implements `PasswordVault` (`src/backend/password-vault.ts`). The developer
instructions tell agents about the vault only while `PasswordVault.connected()` is true, read at
each session start and resume, because most users have no vault. The agent service
uses it in two places: `openbot_browser.list_logins` returns the logins saved for the tab's HTTPS
site (id, title, username), and `AttentionRegistry` answers a `submit_secret` password or
authenticator request for a saved login by filling it through the same `prepareSecret` path as the
secure card, with no card. While agent code from `evaluate` can still run in the page,
`BrowserHost` reports `agentScriptedOrigin` and the card opens instead, because that code could read
the filled fields. The mark is per document, and it stays until a main-frame navigation or a close.
A script can also write Cache Storage that a service worker serves as page code, also to a page that
the worker claims after it loaded, so the origin stays tainted in that session. Thus, while a scripted
page is open, no page of its origin in the same session fills. When it ends, a same-origin page of a
connected popup or opener keeps that mark, each other open page of the origin must navigate before
its own fill, and OpenBot clears the origin's Cache Storage and service workers. A fill waits for that purge, and runs it again when no other page of
the origin is open. A page whose navigation a service worker handled must reload once. Cookies, localStorage and
IndexedDB stay, because clearing them signs the user out and deletes offline data. So a site whose
own code runs a stored value as code is not protected, as from any other script that the site
loads. The same rules apply to `fill_card`. A login matches by 1Password's autofill rule, on the registrable domain
with private suffixes such as `github.io` counted. Agents and providers never receive the token, a
password or a code.

The Bitwarden connector also implements `PasswordVault`. It uses an installed `bw` executable,
resolved to an absolute path from absolute `PATH` entries or common installation directories.
It runs fixed arguments without a shell and with an allowlisted environment. The user supplies a
CLI session key after signing in and unlocking Bitwarden outside OpenBot. OpenBot keeps no
connection file and never asks for the master password. The CLI owns its encrypted cache and server
configuration. Each operation has a 30-second deadline and an output limit. Errors discard all
CLI output. Disconnect cancels active calls, and a late call cannot return a credential from an
old session. Eight hours without a successful vault call ends the connection.

Connect requires exactly one folder named `Shared with OpenBot`. Its id scopes later reads.
Each fill syncs and checks the current item, its folder, its saved URI, its deleted state,
and its master-password prompt setting. Only an HTTPS saved URI and an HTTPS page match; a URI with
no scheme counts as HTTPS. The default and base domain URI rules compare the registrable domain, as
Bitwarden does, so `myaccount.google.com` also fills on `accounts.google.com`. The host rule needs
the same host and port. Other URI rules are not supported; those logins use the manual secret card.
The session key can decrypt the wider vault; the folder limit is enforced by OpenBot, not Bitwarden.
All local agents share this grant. Prompt injection can still use an approved account on its own
site; this feature does not authorize or constrain actions after sign-in.

API keys that a task needs, such as for a script or a service, use `openbot.request_api_key`. The
router builds a `form` UI block with one required secret field (`apiKeyFormSpec` in
`src/backend/agent/prompts.ts`), so every client that shows `ask_ui` shows it; no IPC or Team API
contract changed. When the Vault is ready, the form also has a segmented "Save for" field: "All agents
(Vault)", which is selected first, or "Only this agent". For the Vault, `AttentionRegistry` saves the
value with `VaultItems.saveApiKey` and deletes the asking agent's own key with that name, as
`save_api_key` does; every agent then reads the `.vault/<NAME>` file. Otherwise, `AttentionRegistry` saves the value with
`AgentApiKeys` (`src/backend/agent-api-keys.ts`) before the prompt resolves, as
`<userData>/agent-api-keys/<agentId>/<NAME>`: a 0600 file in a 0700 folder, outside every workspace,
and not encrypted. A failed save leaves the form open. The agent gets only the name and the path, and
reads the file in its own command. Only the server owner or an admin can answer. The
value is registered for log redaction when it is saved and at startup, and the stored block keeps no
secret field value. `list_api_keys` and `remove_api_key` are the reverse actions, and deleting the agent
deletes its folder. The form is refused in Slack, Discord and Telegram chats.

When the agent already has a secret, such as one that the user pasted in the chat, `openbot.save_api_key`
saves it in the encrypted Vault as an `apiKey` item for every agent (`VaultItems.saveApiKey`), and
`openbot_browser.save_vault_item kind=login` saves a website password (`VaultItems.saveLogin`). Both
register a value of 8 or more characters for log redaction when the call arrives, before any check;
the Vault registers a shorter value when it saves it. Both work only when a
person's message in this computer's OpenBot chat started the turn, as for workflow changes: an
external chat, a team member, a routine, another agent, or a web page cannot replace a key or a
password. In a channel task, `save_api_key` saves only a value that the request of the root task holds
as a whole token of 8 or more characters, when this computer's user wrote that request
(`ChannelService.localRequestHolds`, #6369), and only under a name that the agent has no key for
yet: the agent also reads the lead's and the other members' words there. Otherwise, it tells the
agent to call `request_api_key`, whose form works in a channel and can replace a key. They return no secret. `save_api_key` replaces a Vault key with the same name and deletes
the calling agent's own key with that name, because the agent's own key wins in `list_api_keys`.
Another agent's own key with that name stays and still wins for that agent. The value is in the provider's
transcript because the agent sent it; OpenBot keeps no tool arguments in its trace. An agent cannot
delete a Vault key: for a name that only the Vault has, `remove_api_key` fails and tells the agent
that the user deletes it in Server settings > Vault.

`password-vault-router.ts` joins metadata from every manager and prefixes Bitwarden ids with
`bitwarden:` and Proton Pass ids with `proton:`. Existing 1Password ids stay unchanged. The
router reads 1Password and Bitwarden from their services, and one source for each driver of the
password-manager engine (see [integrations](integrations.md#password-managers-on-a-joined-server)). A failed list stops automatic account selection
rather than hiding a source and selecting a different account. Main returns only connection state
through the local Bitwarden IPC group. The shared panel is used in desktop Marketplace and server
settings.

A session key from one computer cannot open the vault of another, so a joined server signs in with
its own CLI (`bitwarden-connector-v1`, see [integrations](integrations.md#bitwarden-on-a-joined-server)).
An owner or admin enters the server address (Bitwarden or a self-hosted Vaultwarden, `https:` only),
the personal API key (`client_id`, `client_secret`) and the master password in the desktop or browser
client. The host keeps them in `openbot-bitwarden-connector-v1.json`, encrypted with `safeStorage`,
and its CLI data in `<userData>/provider-state/bitwarden-host` (`BITWARDENCLI_APPDATA_DIR`), apart from
any `bw` configuration of the user. Without `bw` on `PATH`, it downloads the release that
`src/main/bitwarden-cli-installer.ts` pins, with a SHA-256 per target, into
`<userData>/provider-state/bitwarden-cli`. It runs `bw config server`, `bw login --apikey` and
`bw unlock --passwordenv`; the secrets go to `bw` only in its environment. After a restart or eight
idle hours, the next vault call unlocks again from the stored record. Disconnect removes the record and
the CLI data. The phone shows the connector with no action.

The GitHub connector is built in and has no SQLite row. `src/main/github-connector-service.ts` signs
in to the `openbotgit` GitHub App with the device flow, which needs only the public Client ID, and keeps
the tokens in `openbot-github-connector-v1.json`, encrypted with `safeStorage`. While it is
connected, `McpGateway.enabled()` adds the `openbot-github` server (`api.githubcopilot.com/mcp/`),
and `mcpAuthorization()` gives it a fresh bearer at each hand-off. An enabled server that the user added
with the name `github` wins. For `gh` and `git`, the service writes the token to
`<userData>/provider-state/github` (mode 0600), and each provider gets `GH_CONFIG_DIR` and a
`GIT_CONFIG_*` credential helper that reads that file. The environment holds only paths, never the
token. Codex gets these values through `shell_environment_policy.set` in the thread config.

A user token makes GitHub show "user with OpenBotGit". To show `openbotgit[bot]`, the desktop sends
the user token to `POST /v1/github/installation-tokens` on the account Worker
(`apps/auth-api/src/server/github-installation-tokens.ts`). The Worker holds the app's private key
(`GITHUB_APP_PRIVATE_KEY`, PKCS #8) and signs an app JWT. It mints one installation token for each
installation of this app, limited to the repositories where the user can push, maintain or
administer, and stores nothing. The request names the permissions that the installation granted,
without `administration`: GitHub limits a user token to what its user can do, but not an
installation token, so a user with push access would get admin access through one. The app asks
for `administration: write` only because GitHub needs it to create a repository. Creation uses the
user token, so a user creates only where GitHub lets that user create. When an installation has not
granted the permission, the proxy adds an explanation to the `create_repository` error that the
agent can give to the user. With no key it answers 503, and the desktop keeps the user token.
`src/main/github-bot-tokens.ts` renews the set ten minutes before the first token expires.
- `git`: the helper runs with `useHttpPath`, and takes the bot token for the repository from
  `provider-state/github/repositories`, or else the user token.
- MCP: `src/main/github-mcp-proxy.ts` is a loopback MCP server with a secret bearer. It forwards to
  `api.githubcopilot.com/mcp/` with one upstream client for each token, because GitHub binds an MCP
  session to its token. A tool call with `owner` and `repo` arguments uses that repository's bot
  token. The port and the secret stay in the encrypted record, so a resumed Codex session keeps its
  URL and header.
- `gh` has one token for each host, so it acts as the user.

A pull request that an agent opens with a bot token has `openbotgit[bot]` as its author, so the user
who asked for it can approve it. A branch rule that needs one approval then passes with no second
person.

## Local skill library

`src/main/local-skill-library.ts` owns immutable revisions under the application's user-data directory, in `local-skills/<local-skill-uuid>/<revision>/bundle.zip`. A staging directory is renamed only after the bundle is written; reads ignore unpublished staging directories. Revisions are serialized and checked against the caller's expected revision. No SQLite migration is required.

`create_skill` and `revise_skill` publish a folder of the agent's workspace. An agent often writes a plain frontmatter value with a colon, such as `description: Use when: ...`, which YAML refuses. When the frontmatter does not parse, the library quotes each top-level plain value that has a colon and tries again. When that parses, the bundle gets the quoted `SKILL.md`; the folder in the workspace does not change. Otherwise the publish fails as before.

The shared package validator handles local and marketplace bundles. The existing installer owns per-agent files, hashes, disabled storage, and both provider directories. Local installations skip marketplace downloads and receipt requests. Installation operations are serialized per agent; a library revision does not update installed copies.

A pack is one bundle that holds skills of its own in `skills/<slug>-<name>/SKILL.md`. The installer writes each one as the sibling folder `<slug>-<name>` in both provider directories, so a provider finds it and `$<slug>-<name>` lists it, and keeps them all under the pack's one lock entry: install, update, disable, enable and removal act on every folder together, with one download and one install receipt.

The backend local skill tools derive the agent from the calling provider session. Main-process IPC validates local library inputs independently of sender validation. The renderer reads local previews through that bridge. The released Team API adapters are unchanged; local creation and revision are not exposed as remote operations.

## Plugin distribution

A plugin is one developer's bundle: an MCP server, shown as an app, the skills that drive it, and the listing text. The catalog of available plugins is a static file set that the Account Worker serves from `openbot.run` without an account, and the main process keeps a copy in the user-data directory rather than in SQLite, because a remote catalog is a cache and not the source of truth. An install saves the app as a host-global MCP server and installs the pinned skills into the chosen agent. A share link at `openbot.run/plugins/<slug>` opens a public page, and `openbot://plugins/<slug>` opens the listing in the app; neither one installs anything.

See [plugin distribution and sharing](../plugin-distribution.md) for the catalog shape, the fetch and cache rules, the install and uninstall order, the deep-link parser rules, and the security review. Three parts of that design run today. The Apps tab installs the listing's pinned skills into the chosen agent and saves its app as a host-global MCP server. The links work: `openbot.run/marketplace/apps` (which `openbot.run/plugins` redirects to) and `openbot.run/plugins/<slug>` are pages on the public site, and `openbot://plugins/<slug>` opens that listing in the app, which is one of the link kinds that `src/main/deep-link-router.ts` recognises beside an invitation. Both sides read one catalog, generated from `marketplace/plugin-catalog/`, because a listing that said one thing on the page and another in the app would be two catalogs. The Apps tab also uninstalls a listing. The catalog files, the Worker routes that serve them, and the cache in the main process are still design.
