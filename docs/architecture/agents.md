# Agents

## Local script runs

`src/main/automation-server.ts` is a loopback HTTP listener through which a local script runs a
routine of an agent that allows it. [docs/automation.md](../automation.md) has the routes and the
commands. The listener runs only while at least one agent has `allowAutomation`, and binds
`127.0.0.1` on a free port. It writes the URL and a new bearer token to `<userData>/automation/`
(folder `0700`, files `0600`) and deletes them when it stops. It refuses any request with an
`Origin` header or a foreign `Host` before it checks the token, so a web page cannot reach it.

A run is a manual routine run with the payload after the instruction, so no Team API protocol, run
kind or sender changes. The payload is in the run row, and `resumePendingRuns` sends it again after a
crash. The flag is in `agent_json` and needs no migration; a profile without it is off. Only the user
changes it, on the computer that runs the agent: the Team API parser and the agent profile tools do
not accept it, the remote IPC branch refuses it, and duplication does not copy it. When the flag is
on, the developer instructions name the two file paths, never the token.

## Routine calendar feed

`src/main/routine-feed-server.ts` is a loopback HTTP listener that serves the routines of this
computer as an iCalendar feed (`src/main/routine-feed-ics.ts`) for Server Settings > Routines. It
runs only after the user makes a feed URL, and binds `127.0.0.1`. The URL is
`/routines/<token>.ics`, with an optional `?agent=<id>`: a calendar app cannot send a header, so the
token is in the path. `<userData>/openbot-routine-feed-v1.json` keeps the token, encrypted with the
secret storage cipher, and the port, so the URL stays the same after a restart. When the port is not
free, the listener takes a new one and saves it. **New URL** replaces the token, and **Turn off**
deletes the file. A wrong token gets 404. A request with an `Origin` header or a foreign `Host`
gets 403 before the token is checked. Logs never contain the URL.

The feed lists each run of the next 30 days of active routines as one UTC event, placed by the same
schedule code that fires the run, so it needs no RRULE or time zone rules. Nothing leaves the
computer: a calendar service that fetches feeds from its own servers, such as Google Calendar or
iCloud, cannot read it.

## Agent communication policy

The shared developer instructions keep routine teammate exchanges internal by default. Agents
should start or resume work without narrating setup, context loading, discovery, or readiness.
Progress updates focus on meaningful outcomes, completed work, material changes, blockers, failures,
and required user input or approval. Delegated work still needs an explicit reply to the requesting
teammate; acknowledgements must not become loops. Relevant findings belong in the task result, and
the user can ask for a detailed coordination report.

An agent does not refuse a task, or say that it has no access to a service, before it tries each
path. When the task is outside its profile, or names a service that a teammate may own, it calls
`openbot.list_agents` first and delegates to a teammate whose name, title or description covers
the work. In a channel task it delegates only to a channel member. MCP servers are host-global, so
a specialist teammate differs only by its profile, skills and memories. Otherwise the agent uses its
connected MCP servers, its skills, the embedded browser and Computer Use.

A sign-in page does not stop it: it calls `openbot_browser.request_takeover`. The request shows in
the agent's conversation, and in the dynamic island when the agent's notifications are on, also for
delegated work. A routine run reports the sign-in instead, because nobody may answer; a requester in
a routine run says so in the delegated message. The tool returns only after the user answers, which
can take minutes. The end of the turn cancels the request, so the agent keeps waiting for the result,
also when the provider returns control while the call runs. In the smoke runs, Codex `exec` did this
about every 30 seconds. After an error or a cancel, the agent does not point to a takeover window.
When the agent reaches a service in the browser and the plugin for it is not in its tools, the answer
ends with a fixed sentence: install the plugin in Marketplace, on the Apps tab, or enable it in MCP
servers. The sentence names both actions because `read_agent` and the agent's tools show only enabled
servers, so an agent cannot tell a disabled plugin from a missing one.

When its own tools fail, the agent checks its teammates. When a teammate reports that it is blocked
or waits for the user, the requester does not repeat that work or send the same request again; it
gives the user the blocker and the unblock action. A blocked task reply adds a fourth line,
`Unblock:`, after Status, Result and Evidence. The delivery text of that reply
(`src/backend/agent/delivery-content.ts`) repeats the report rules, because the requester reads it
at the moment it answers. An earlier failure does not stop the agent from asking that teammate for
a new request. It never sends a task back to the teammate that gave it. The answer that gives a
delegated result starts with the teammate's name, and the agent does not say that a service was
checked unless a tool result or a reply shows it. When nothing works, the agent says what was tried
and the one action that unblocks it; for a service with a plugin, that action is to install or
enable the plugin. It can offer to create a specialist teammate, but it creates one only after the user agrees.

An agent that delegates work can follow and stop it. `openbot.list_agents` reports each agent's
`status` (a starting delivery and a context compaction count as `working`), `queuedMessages`
(channel work excluded), `turnStartedAt`, and `lastActivityAt`. The last two come from the provider
notifications that `TurnLifecycle` sees; they are in memory only, so after a restart
`lastActivityAt` falls back to the newest message for the agent. OpenBot does not record which
files a turn changed. `openbot.interrupt_agent` (`src/backend/agent/agent-interrupt-tool.ts`)
refuses the caller itself, a channel turn, and a turn that any delivery other than the caller's
started, so an agent cannot stop work from the user, a routine, or another agent. It cancels the
caller's queued requests to the target before it sends `turn/interrupt`, because the interrupted
turn drains the queue as it completes. It keeps the caller's answers, because the target can hold
them (see below). Then it queues a notice from the caller with `expectsReply` false. The notice
starts one short turn on an idle target, so the provider thread records why the work stopped.

An answer to a request that went to two or more teammates waits in the requester's queue while
another teammate's copy of that request is queued, starting or running (`MailboxStore.nextQueued`).
When the last copy ends, the waiting answers start in one turn, and the prompt names each teammate
whose copy ended with no answer. A message from the person does not wait: it starts at once and
takes the answers that are already in. Each end of a copy schedules a drain for the requester.

This policy lives in `src/backend/agent/developer-instructions.ts` and is supplied on both thread
start and resume. Codex receives `developerInstructions`; Claude appends them to its system prompt;
Grok receives them as a tagged instruction block in normal turn input. There is no model-specific
verbosity setting or response filter. Delivery is tested, but compliance depends on the provider,
model, and existing conversation context; Grok's input block is not a dedicated system message.
Restarting the app reapplies the current policy without deleting conversation history. The policy
does not hide mailbox records, tool activity, approvals, or failures in desktop or mobile clients.

### Model evaluation scenarios

Run these scenarios in an isolated test profile with two agents, separately for Codex, Claude, and
Grok. Record provider/model versions, prompts, and observed responses. Repeat collaboration after
an app restart using the same conversation, including one with earlier verbose coordination.
These are manual model evaluations, separate from the fake-provider lifecycle regression tests.

| Scenario | Expected behavior |
| --- | --- |
| On a new conversation, ask an agent to research a topic with one teammate. | Work begins without a setup, discovery, or readiness monologue. |
| Exchange routine scope clarifications and acknowledgements during that task. | No user-facing message-by-message recap or acknowledgement loop. |
| Have the teammate finish its research and send findings back. | The requesting agent receives the result; the user receives a concise useful synthesis. |
| Have the teammate report a failed step, a blocker, or a finding that changes the recommendation. | The user sees the consequence and any required decision. |
| Include a step that requires approval or clarification. | The existing approval/question flow remains visible and the agent waits for the answer. |
| Restart the app, then ask the agent to continue the same task. | Work continues with the same policy and no context-loading recap. |
| Ask explicitly for a detailed account of teammate coordination. | The agent provides the requested detail. |
| Make a teammate whose description owns Notion, then ask a general agent about a Notion page. | The general agent delegates to the Notion teammate. Its answer starts with the teammate's name. |
| Ask the same question with no Notion plugin installed. | The Notion teammate opens Notion in the browser and requests a takeover for sign-in. When sign-in fails, the answer says what was tried and to install the Notion plugin. |

## Prompt-driven agent profiles

Users create and edit agent profiles by asking an agent in the normal desktop or mobile
conversation. `openbot.create_agent` creates a persistent teammate with instructions and a first
task; `openbot.update_profile` changes an existing agent's name, title, instructions, generated
or custom avatar, provider, model, reasoning effort, access, Computer Use, or notifications. `avatarPath` accepts a local PNG, JPEG, or WebP file up to 512 KB, with relative
paths resolved from the calling agent’s workspace. The agent uses its available tools to resize or
compress a copy when needed. OpenBot validates the prepared file before profile changes and copies
it into managed avatar storage. Generated avatar settings remove the custom image. Both run through
the existing agent service and validate arguments before changing state.
`openbot.create_agent` also accepts an optional `provider`, `model` and `reasoningEffort`. The
read-only `openbot.list_models` returns the models of each provider that the model picker shows, with
their reasoning efforts and the default model for a request that names only a provider. An unknown
model or an unsupported effort is an error that names the valid values; OpenBot checks them before
it creates the agent. Without a provider and a model, the new agent starts on the calling agent's
provider, model and reasoning effort, so a team that one agent creates runs where that agent runs.
When the caller's provider no longer lists its model, the new agent starts on the user's default.
Creation stays this small. The calling agent then configures the new agent, or any other local
agent, with the same tools that act on itself. `openbot.read_agent` returns one agent's setup:
profile, runtime, access, Computer Use, notifications, auto-approve, installed skills, routines,
and the names and transports of the MCP servers it gets. It does not return MCP commands,
environment values, URLs, or headers, because they can hold secrets. `install_local_skill`,
`set_skill_enabled`, `uninstall_skill`, and the routine tools take an optional `agentId`; without
it they act on the caller. `uninstall_skill` never removes skill files that the user changed.
An agent can only restrict access and Computer Use, for itself or a teammate. The router writes
only a restriction, so a user change between its check and the write is never undone. Only the
user widens them again, and only the user changes auto-approve, MCP servers and local script runs. A new agent gets
the access and Computer Use limits of the agent that creates it, so a Workspace-only agent cannot
get around its sandbox through a teammate. There is no creation step for skills or routines in
the UI.
Codex and Grok receive the dynamic tool definitions; Claude exposes the same operations through
its SDK MCP bridge. `src/backend/openbot-tools.ts` owns the tool names, descriptions, and Zod
argument shapes used by both declarations. It reuses the profile, section, and routine schemas.
Claude uses the SDK’s `AskUserQuestion` flow instead of the `ask_user` MCP tool.
There is no separate prompt-generation button or review dialog.

Agents can organize teammates into flat sidebar sections through `list_sections`, `create_section`,
`rename_section`, `delete_section`, and `assign_agent_section`. Assignment accepts a null section
to ungroup an agent; deleting a section also ungroups its agents without deleting them. These tools
use the same `SidebarLayoutStore` as manual sidebar edits, including persistence, validation,
and change events delivered to desktop and connected clients.

`html_render` publishes a visual reply: an HTML page that shows above the agent's reply. The router
stores the page as a generated `text/html` attachment and adds an assistant message with the item
type `visual-reply:<height>` and the page title as its text (`@openbot/contracts/chat-visual`). A
client that does not know the item type shows the title and the file. A visual message is not
readable: unread counts, latest-message previews and mobile read state skip it. The desktop serves
the page on `openbot-visual:` (`openbot-remote-visual:` for a remote host) with
`Content-Security-Policy: sandbox allow-scripts allow-forms` and the frame script, and the frame has
the same sandbox without `allow-same-origin`. The page runs its scripts and can load files from the
network, but it has an opaque origin, gets no permission, and talks to the app only with the checked
MCP Apps messages for its height, its theme and a link that the user clicked. Mobile downloads the
page through the team connection and shows it in a `srcdoc` frame with the same sandbox, inside an
Expo DOM component. `html_preview` lets the agent look at a page before it publishes it: the main
process draws it in a hidden offscreen window with its own in-memory session (`ChatVisualPreviewer`)
and returns a PNG, the content height and the console lines. The file preview shows an HTML file in
the same frame.

Codex fixes dynamic tools at provider-session creation; resume does not update them. A local
`provider-toolsets` manifest records the tool fingerprint for each new Codex session. Sessions with
missing or outdated fingerprints are replaced before the next turn, using the existing history
handoff while retaining the public thread, agent identity, workspace, and stored conversation.
Unchanged fingerprints resume the existing session. Pending history handoffs are written before
the replacement is bound, reloaded after restart, and removed after a turn accepts the handoff.

The same handoff carries a chat to another provider after a provider switch. It holds the user and
assistant messages after the last context-reset marker, with attachment names only. OpenBot stores
no tool steps, so the work log comes from the providers. At the switch, before the old sessions are
retired, `ThreadLifecycle.readWorkSteps` reads each active session with `thread/read` through the
client that holds it, with a 10-second limit. The switch then checks again that no turn started.
Only after the switch is stored, `saveWorkSteps` writes the rendered steps of the 60 newest turns to
`provider-work-steps/<sha256(session id)>` (mode 0600), or `{}` for a session with none. The sessions
are retired before the write, so a turn that starts during it keeps its new session and reads the
provider instead. The file is
deleted and reconciled with the other session files, and a file that does not parse counts as no
capture. A session without a capture, such as one that no client held, is read when the
handoff is built: only the three newest, on their own providers, with a stopped CLI started again
and one 10-second limit for the start and the read. From the turns that match a transcript message,
`renderTurnSteps` adds a work log: commands with exit code and output tail, changed file paths, tool
calls, searches and progress notes. Each field is redacted before it is cut, and each turn has a
size limit. Reasoning, diffs, images and other provider-private state stay with the provider that
made them. A failed capture or read leaves that session's steps out. Codex returns tool steps from
its stored rollout. Claude returns only notes. An ACP agent keeps only the text and thinking of its
turns, so it also gives only notes, and only while its process holds the session: the handoff read
sends no `cwd`, as the boot backfill does, so a session that the process released is not opened
again. That handoff read uses the shared provider process, so a session that ran in a Workspace only
process gives no steps unless the switch captured it.

The optional `agent-profile-generation` Team API endpoints remain available. They use a separate
provider client with tools restricted and validate drafts before returning them. Their save path
retains its recovery and retry guarantees:

A profile-creation marker is written before its workspace or agent row. Startup removes
uncommitted creations before mailbox initialization and queue draining, while a committed
retry receipt preserves the agent and its introduction. The existing sidebar reconciliation
removes assignments for recovered incomplete agents.

Reviewed instructions use the existing profile description. Profile saves coordinate
SQLite with the separately stored sidebar layout, rolling back section assignment
on failure. Updating an existing profile and its retry receipt shares a SQLite
transaction. Creation follows the existing workspace/initial-message flow with
cleanup on failure. Receipts make retries after a lost response return the saved
agent. This does not introduce a schema migration or alter released protocol codecs.

## Agent import

Server Settings > Import moves agents from a `.zip` export into the local host, or into a remote host
that serves `agent-import-v1` (see [Agent import from a joined server](servers.md#agent-import-from-a-joined-server)).
The format is `openbot-import.json` plus `agents/<key>/`
folders. `resources/agent-import/grok-bot/SKILL.md` writes it and `src/main/agent-import-manifest.ts`
reads it; both are a product contract, so add only optional fields and raise `version` for a change
of meaning. The renderer never names a path: `agent-import:choose` opens the dialog in main, and
`AgentImportService` keeps the checked export and its SHA-256 under a single-use token; `apply`
refuses a file that changed. `stage` measures entries without inflating them and rejects paths that
`isUnsafeArchivePath` in `skill-package.ts` refuses or that name a Windows drive. `apply` checks all
skills of an agent, creates it through `AgentService` and publishes skills through the local skill
library; an agent whose step fails is deleted with the skill revisions it published, and the others
continue. An optional `channels` list carries Grok Bot group chats. After the agents, each selected
channel is created through `ChannelService.command` as the local user (`host.channelActor()`), with
the members and lead mapped to the new agent ids; a channel needs one imported member, and one whose
memory step fails is deleted. Step 1 offers two ways to add the export agent: its Grok Bot link, or the skill set up by hand.
`agent-import:read-skill` and `agent-import:save-skill` give that skill from the app's resources
(`extraResources` in `electron-builder.yml`); main opens the save dialog, so the renderer names no path. No schema change is needed.

## Agent templates

An agent template is a link-only copy of one local agent: the name, title and instructions, the
avatar, the routines, marketplace skills as references to approved versions, and local skills as
their `SKILL.md` text. It has no workspace files and no memories. The Publish button in the chat
header opens `PublishAgentDialog`; `src/main/agent-template-service.ts` builds the snapshot, stops
when a text field looks like a secret, and posts it to the Account Worker. The Worker keeps one row
per account and local agent in D1 `agent_templates`, so a second publish updates the same link.
Unpublish clears the row's content and images and sets `unpublished_at`, but keeps the row, so the
same agent published again gets the same link. An account can have up to 5 published agents; the
Worker checks this in the statement that writes the row, so a client or two requests at once cannot
pass it, and unpublished rows do not count.
There is no review and no marketplace listing. Before a publish, the renderer draws a 1200×630 share
card (`agent-template-card.tsx`) with the agent's avatar and text. It draws it there because the
avatar and its fonts are there, and it uses a `data:` URL because the Content Security Policy
refuses `blob:` images. The Worker accepts only a PNG of that size, stores it in R2, and serves it
as the page's `og:image`, so a post on X shows the agent. `openbot.run/agents/<id>` is a public
card page, tinted with the avatar colour. The Bloub library uses browser-only APIs when its module
loads, so the page loads the avatar and its colour in the browser after hydration. Its button opens
`openbot://agents/<id>`, the third renderer link kind in
`src/main/deep-link-router.ts`. The app then shows the template in `AgentTemplateInstallDialog`;
like a plugin link, the link itself installs nothing. The page's fallback line also links
`/app?agent=<id>`, where the browser client shows the same preview. In the same way, the invitation
page links `/app` with the four invitation fields, and a plugin page links `/app?plugin=<slug>`. The
browser client removes these fields after it reads them and opens the join dialog or the marketplace
listing. It never joins or installs without a press.
