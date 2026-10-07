# Skills and plugins

## Skill folders and MCP configuration

A skill follows the [Agent Skills specification](https://agentskills.io/specification): a folder
`<name>/` with a `SKILL.md` file. The YAML frontmatter has `name`, which is the folder name, and a
`description` of 1 to 1024 characters. Each provider CLI finds skills in its own folders:

| Folder | Written by | Read by |
| --- | --- | --- |
| `<workspace>/.agents/skills/` | OpenBot, the user, the agent | Codex, Grok, OpenCode, Gemini, Cursor, Cline |
| `<workspace>/.claude/skills/` | OpenBot, the user, the agent | Claude Code, OpenCode, Cursor |
| `<workspace>/.opencode/skills/` | the user, the agent | OpenCode |
| `<workspace>/.gemini/skills/` | the user, the agent | Gemini |
| `<workspace>/.cursor/skills/` | the user, the agent | Cursor |
| `<workspace>/.cline/skills/`, `<workspace>/.clinerules/skills/` | the user, the agent | Cline |
| `~/.agents/skills/` | the user | Codex, Grok, OpenCode |
| `~/.claude/skills/` | the user | Claude Code, OpenCode |
| `~/.codex/skills/`, `~/.config/opencode/skills/` | the user | Codex, OpenCode |

A confined agent (Grok, OpenCode, Gemini, Cursor or Cline, not in Full access) cannot write the workspace
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

OpenBot does not list the home-directory folders. They hold the host user's skills, which are the
same for every agent, and each provider CLI changes its home-folder rules without notice.

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
secure card, with no card. On an origin where an agent ran `evaluate` during this app session,
`BrowserHost` reports `agentScriptedOrigin` and the card opens instead, because the agent's script
could read the filled fields. A login matches by 1Password's autofill rule, on the registrable domain
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
Each fill syncs and checks the current item, its folder, its saved HTTPS origin, its deleted state,
and its master-password prompt setting. Default, domain, and host URI rules use exact HTTPS origin
matching. Other URI rules are not supported; those logins use the manual secret card.
The session key can decrypt the wider vault; the folder limit is enforced by OpenBot, not Bitwarden.
All local agents share this grant. Prompt injection can still use an approved account on its own
site; this feature does not authorize or constrain actions after sign-in.

`password-vault-router.ts` joins metadata from both managers and prefixes Bitwarden ids with
`bitwarden:`. Existing 1Password ids stay unchanged. A failed list stops automatic account selection
rather than hiding a source and selecting a different account. Main returns only connection state
through the local Bitwarden IPC group. The shared panel is used in desktop Marketplace and server
settings; remote web and mobile clients do not manage this local connection.

The GitHub connector is built in and has no SQLite row. `src/main/github-connector-service.ts` signs
in to the `openbotgit` GitHub App with the device flow, which needs only the public Client ID, and keeps
the tokens in `openbot-github-connector-v1.json`, encrypted with `safeStorage`. While it is
connected, `McpGateway.enabled()` adds the `openbot-github` server (`api.githubcopilot.com/mcp/`),
and `authorization()` gives it a fresh bearer at each hand-off. An enabled server that the user added
with the name `github` wins. For `gh` and `git`, the service writes the token to
`<userData>/provider-state/github` (mode 0600), and each provider gets `GH_CONFIG_DIR` and a
`GIT_CONFIG_*` credential helper that reads that file. The environment holds only paths, never the
token. Codex gets these values through `shell_environment_policy.set` in the thread config.

A user token makes GitHub show "user with OpenBotGit". To show `openbotgit[bot]`, the desktop sends
the user token to `POST /v1/github/installation-tokens` on the account Worker
(`apps/auth-api/src/server/github-installation-tokens.ts`). The Worker holds the app's private key
(`GITHUB_APP_PRIVATE_KEY`, PKCS #8) and signs an app JWT. It mints one installation token for each
installation of this app, limited to the repositories where the user can push, maintain or
administer, and stores nothing. With no key it answers 503, and the desktop keeps the user token.
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

The shared package validator handles local and marketplace bundles. The existing installer owns per-agent files, hashes, disabled storage, and both provider directories. Local installations skip marketplace downloads and receipt requests. Installation operations are serialized per agent; a library revision does not update installed copies.

The backend local skill tools derive the agent from the calling provider session. Main-process IPC validates local library inputs independently of sender validation. The renderer reads local previews through that bridge. The released Team API adapters are unchanged; local creation and revision are not exposed as remote operations.

## Plugin distribution

A plugin is one developer's bundle: an MCP server, shown as an app, the skills that drive it, and the listing text. The catalog of available plugins is a static file set that the Account Worker serves from `openbot.run` without an account, and the main process keeps a copy in the user-data directory rather than in SQLite, because a remote catalog is a cache and not the source of truth. An install saves the app as a host-global MCP server and installs the pinned skills into the chosen agent. A share link at `openbot.run/plugins/<slug>` opens a public page, and `openbot://plugins/<slug>` opens the listing in the app; neither one installs anything.

See [plugin distribution and sharing](../plugin-distribution.md) for the catalog shape, the fetch and cache rules, the install and uninstall order, the deep-link parser rules, and the security review. Two parts of that design run today. The Apps tab installs the listing's pinned skills into the chosen agent and saves its app as a host-global MCP server. The links work: `openbot.run/plugins` and `openbot.run/plugins/<slug>` are pages on the public site, and `openbot://plugins/<slug>` opens that listing in the app, which is the second kind `src/main/deep-link-router.ts` recognises beside an invitation. Both sides read one catalog, generated from `marketplace/plugin-catalog/`, because a listing that said one thing on the page and another in the app would be two catalogs. The catalog files, the Worker routes that serve them, the cache in the main process, and uninstall are still design.
