# Glossary

The product terms OpenBot uses, and the identifiers each one owns. Read this when naming a new type,
table, IPC channel or product string, or when a term in the code disagrees with the term in the UI.
[AGENTS.md](../AGENTS.md#terms) carries the two naming rules that are decisions rather than lookup.

- **agent**: the product object (`AgentStore`, `AgentSummary`, `agent-${uuid}`,
  `~/OpenBot/Agents/<id>`, `projection_agents`), a coding agent, or a marketplace agent
  (`ipc-marketplace-agents.ts`). **teammate** is prompt and marketing text, never a type.
  Human members use `TeamMemberSummary`.
- **bot**: do not use for new product code. Keep released names: Team API v1-v3
  `bot`/`botId`/`bots-changed` (`current-agent-keys.ts` translates), `bots.json`, `mailbox.json`,
  `legacy-import:bots:v1`, and readable `~/OpenBot/Bots` path prefixes. Accept `bot-<uuid>` IDs from
  databases that did not run migration v13. `"first-bot"` is an avatar seed; `BloubBot` and the
  lucide `Bot` icon are library names.
- **channel**: the shared multi-agent chat (`ChannelStore`, `ChannelSummary`, `projection_channels`,
  `channel-chats-v1`). **group** is not a product term: it means a sidebar section
  (`SidebarPinnedGroup`, `create_section`), an IPC endpoint group (`IpcEndpointGroup`,
  `define-ipc-group.ts`), or an ARIA `role="group"`. An IPC **channel** is the wire name of an
  endpoint in `IPC_ENDPOINTS` (`ipc-endpoints.ts`); the product contract is `ipc-chat-channels.ts`.
- **server**: a joined team server (`ServerSummary`, `servers:*`), the local Team API host
  (`HostStatus`, `host:*`, `src/main/team-api-server.ts`), the account API (`apps/auth-api`,
  `auth:*`), or an MCP server (`createSdkMcpServer`).
- **thread**: durable `projection_threads` record. **conversation**: its read projection, with no
  separate table. **provider session**: private CLI resume state (`projection_provider_sessions`).
  **team session**: authenticated remote connection. **turn**: one exchange in a thread.
- **routine**: a scheduled instruction for one agent (`projection_agent_routines`), not Claude
  Code `/schedule`.
- **shared table**: a table an agent created in the one file every agent shares
  (`~/OpenBot/Shared/Data/agent-data.db`, `SharedTable`, `AgentTables`). `openbot.db` is the
  application's database and holds none of these. **owner**: the agent whose id
  `openbot_metadata` records for a table, and the only agent that can drop or alter it; every other
  agent can still read and write its rows, and the user can delete any table in agent settings.
