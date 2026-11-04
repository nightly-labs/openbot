# Glossary

The product terms OpenBot uses, and the identifiers each one owns. Read this when naming a new type,
table, IPC channel or product string, or when a term in the code disagrees with the term in the UI.
[AGENTS.md](../AGENTS.md#terms) carries the two naming rules that are decisions rather than lookup.

- **agent**: the product object (`AgentStore`, `AgentSummary`, `agent-${uuid}`,
  `~/OpenBot/Agents/<id>`, `projection_agents`), a coding agent, or a marketplace agent
  (`ipc-marketplace-agents.ts`). **teammate** is prompt and marketing text, never a type.
  Human members use `TeamMemberSummary`.
- **agent template**: a public, link-only copy of one agent's instructions, skills and routines
  (`ipc-agent-templates.ts`, `agent-templates:*`, D1 `agent_templates`, `openbot.run/agents/<id>`).
  It holds no workspace files and no memories. It is not a marketplace agent: it has no review and
  no listing.
- **browser profile**: a named, persistent browser session on the computer that runs the agents
  (`browser_profiles`, `BrowserProfileSummary`, `AgentBrowserProfile`, `agent:admin:*-browser-profile*`,
  `persist:openbot-browser-profile-<id>`). The built-in choices "Shared" and "Only this agent" (shown
  only to an agent that already uses it) are also profiles in the UI, but they have no row. It is not an **agent profile** (`AgentProfile`, the
  display data of an agent) or the account profile (`v1/me/profile`).
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
- **connector**: a built-in sign-in to an outside service that OpenBot turns into agent tools, one
  for each OpenBot computer (`GitHubConnectorService`, `github-connector:*`,
  `GITHUB_CONNECTOR_MCP_SERVER_ID`). A user-added MCP server or a marketplace plugin is not a
  connector.
- **messaging connection**: one workspace of an external chat platform (a Slack workspace, a Discord
  guild or a Telegram chat), where this computer's agents answer (`projection_messaging_connections`,
  `MessagingConnection`, `messaging:*`). Its **Slack Orchestrator** is the agent that receives each
  new conversation and asks its teammates. A **messaging thread** is one external conversation (a Slack thread) that one agent
  answers in its own execution thread (`projection_messaging_threads`, `MessagingLink`). A Slack
  channel is a `platformChannelId`, never a **channel**.
- **server**: a joined team server (`ServerSummary`, `servers:*`), the local Team API host
  (`HostStatus`, `host:*`, `src/main/team-api-server.ts`), the account API (`apps/auth-api`,
  `auth:*`), or an MCP server (`createSdkMcpServer`).
- **thread**: durable `projection_threads` record. **conversation**: its read projection, with no
  separate table. **provider session**: private CLI resume state (`projection_provider_sessions`).
  **team session**: authenticated remote connection. **turn**: one exchange in a thread.
- **side thread**: a second conversation of one agent next to its own chat, the **main thread**
  (`projection_agent_threads`, `AgentThreadRecord`). The UI calls both a thread. Code and the
  `agent-tasks-v1` wire still call a side thread a **task** (`AgentTask`, `taskId`), and its task id
  is `legacy_task_id ?? thread_id`. **archive** hides a side thread from the tabs and lists it under
  "Archived"; it is the task close (`closed`, `archived_at`). A **tab** is a device-local view of a
  thread; closing it does not change the thread. A **branch** is a side thread that starts with a
  copy of another thread through one finished turn (`AgentTaskBranch`, `branch_*` columns). It is
  not a git branch.
- **role**: a custom role of a server that sets which agents its members can use, and at which
  level (`AgentAccessRole`, `agent-access-v1`, `openbot-agent-access-v1.json`). The **Everyone** role
  applies to every member. It is not the team role (`TeamRole`: owner, admin, member), which the UI
  calls the server role. **agent access** in the agent settings is the agent's own runtime access;
  the `agent-access-v1` levels are the access of members to agents.
- **routine**: a saved instruction for an agent or channel, with one schedule or webhook trigger
  (`EventRoutineTrigger`). Agent routines use `projection_agent_routines`. This is not Claude Code
  `/schedule`.
- **webhook routine**: a routine with a webhook trigger (`RoutineWebhookTrigger`). A signed request
  to its URL starts a run. The trigger can require one event type and data filters
  (`projection_routine_webhooks`, `projection_channel_routine_webhooks`). There is no shared event
  source.
- **webhook route**: the opaque route ID of one webhook routine, and the public Signal URL that
  contains it (`WebhookRouteStore`, D1 `webhook_routes`). A **receipt** records one received
  delivery ID for deduplication.
- **workflow**: a graph of steps on the Workflows page that can name several agents, models,
  conditions, approvals and outputs (`WorkflowStore`, `Workflows`, `workflows`, `workflows-v1`). It
  is not a **routine flow**, which hands the answer of one agent's routine on to other agents
  (`routine-flows-v1`). A **workflow run** is one pass through a copy of the graph
  (`workflow_runs`); a **workflow step** is one try of one node, in a run or alone
  (`workflow_steps`). A **workflow version** is a saved copy of the graph that the user can restore
  (`workflow_versions`). A **workflow webhook trigger** is a trigger node with a webhook route of
  the `workflow` owner kind (`workflow_trigger_webhooks`).
- **shared table**: a table an agent created in the one file every agent shares
  (`~/OpenBot/Shared/Data/agent-data.db`, `SharedTable`, `AgentTables`). `openbot.db` is the
  application's database and holds none of these. **owner**: the agent whose id
  `openbot_metadata` records for a table, and the only agent that can drop or alter it; every other
  agent can still read and write its rows, and the user can delete any table in agent settings.
