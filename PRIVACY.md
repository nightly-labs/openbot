# Privacy

OpenBot is local-first, but it is not offline-only. Agent workspaces, conversations, attachments,
browser data, and team data stay on the computer that runs OpenBot. The optional OpenBot account
service stores the minimum central data needed for email sign-in, account avatars, remote host
configuration, memberships, invitations, and logical sessions.

The optional browser client at `/app` connects to the computer that runs OpenBot. Conversation
and attachment data travel through the existing encrypted host connection, not through the
account Worker. The browser keeps chat pages, drafts, search results, and file previews in memory;
it does not create a persistent offline chat cache. Files that the user downloads are saved by
their browser. The host must stay online.

Browser email sign-in uses a persistent host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie.
Browser JavaScript cannot read the account credential. Trusted host public keys are stored in
local storage separately for each account. The shared file preview can also store its panel width.
Signing out revokes that credential's remote sessions and tells other open tabs to clear private
state. Host identity pins remain so a later sign-in cannot silently trust a replacement host key.
The web client adds no chat or account analytics events. It does not send email codes, credentials,
message content, file content, or search queries to telemetry.

Production builds of OpenBot desktop, the configured mobile app, and the website use a self-hosted OpenPanel service for product
analytics. Development builds, previews, tests, and Storybook do not send analytics.

## Agent and host usage

The Usage view stores numeric token counts, activity counts, provider and model identifiers,
internal session and turn identifiers, timestamps, and cost estimates in the host's local SQLite
database. Collection starts when this feature is installed. It does not import old provider
transcripts or store message contents, credentials, or raw provider responses in analytics records.

Authenticated members of a host team can read aggregate usage for that host's agents through the
Team API, including from mobile. Desktop can also show the combined totals for all agents on one
host, with an optional agent filter. A host-wide response carries the combined totals, one row per
day, one row per model, one aggregate row per agent, identified by the agent's internal id, and one
row per day and provider with that provider's token count and cost estimate for the day. Agent
names are not part of the analytics payload; the client shows them from the agent list it already
reads. These records are separate from product analytics and are not sent
to OpenPanel or stored by the account service or Signal service. Conversation clearing retains usage;
agent deletion removes it. A duplicate agent starts with no usage history.

Authenticated members of a host team can also see that host's storage through the Team API: how
much disk space each location, agent and chat uses, and the name, size, type, date and chat title of
each sent or generated file. The response contains no file paths, and workspace and download files
are counted only as totals. Only owners and admins can delete a file or clear caches and logs. A
deleted file is removed from the host's disk; the message that sent it stays and shows that the file
is not available.

Costs are API-equivalent estimates in USD, not subscription charges. Missing usage, unknown prices,
and incomplete billing inputs remain marked as unavailable or partial.

## Product analytics

The production website records anonymous page views using only the fixed paths `/` and `/join`. It
also records download clicks, clicks on allowlisted public links, invitation validity, and open-app
actions on invitation pages. The production desktop app records application, sign-in, onboarding,
agent, message, turn, prompt, approval, queue, routine, team, browser, search, Remote Desktop, update,
marketplace, memory, provider, voice transcription, reaction, maintenance, Hosted Site, and confirmed
application-version-change actions. Event properties are limited to metadata such as counts, result
states, timing, provider, model, reasoning effort, application version, operating system, and coarse
failure codes.

The configured production mobile app records app opens and foreground returns, sign-in QR pairing
and camera-permission outcomes, host connection attempts and losses, conversation-load outcomes,
message and prompt-answer submissions, attachment operations, agent/routine/memory actions,
server selection/join/leave, search result counts, pin/unpin, hide/unhide, Usage views and sign-out.
Mobile properties include app version/build, iOS or Android, result, timing, bounded connection stage,
counts, coarse attachment size buckets, and provider/model/reasoning metadata where available.
Mobile never sends scanned QR values, install-referrer URLs or route identifiers. It does not
emit host lifecycle events again. Agent/host token and cost reports remain separate local data.

Analytics events do not contain message or direct-message text, prompts, replies, generated content,
search queries, embedded-browser URLs or page titles, file names, local paths, commands, raw error
messages, or local identifiers for agents, threads, turns, messages, servers, and team members.
Website page views carry the five standard campaign tags `utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, and `utm_term` when a visitor arrives through a campaign link. Each tag is sent only
as a lowercase label of at most 64 characters made of letters, digits, dots, hyphens, and
underscores; any other value is dropped rather than shortened. No other query parameter, hash, or
invitation value is sent. Session replay and automatic interaction capture are disabled.

When a user signs in, OpenPanel receives the OpenBot account ID and normalized account email so UI
actions can be associated with the account that started them. The email is stored on the OpenPanel
profile and is not copied into individual event properties. Agent lifecycle events are emitted once
by the local host and associated with the host owner's account; clients that observe a remote host do
not emit the lifecycle again. Sign-in attempts and website activity remain anonymous until an account
has been verified. Landing-page attribution includes an allowlisted source category, an allowlisted
platform name (or unknown), and the referring domain when available. A recognized utm_source tag
takes precedence over the referring domain for platform classification; unrecognized tags are not
sent. Attribution excludes referrer paths, query parameters, fragments, credentials, ports, and
campaign URLs other than the allowlisted tags described above. Website page and article events carry
the path of a news article or guide published on openbot.run, together with the collection name, the
reading position reached (start, half, or end), and the section of the page a link was clicked in.
That path is a published article address and nothing else: it is matched against the site's own list
of articles, so no other part of a visited URL can be reported through it. Reading position is taken
from where the article sits on screen, never from how long it was open. Referrals from openbot.run and its subdomains are omitted. OpenPanel can also derive
session, device, browser, operating-system, network, and approximate geographic metadata from a
request. The analytics service runs on OpenBot's self-hosted infrastructure and receives events
through `analytics.openbot.run`.
Analytics is enabled in production by default. Desktop users can disable it under **Settings →
General → Privacy → Share product analytics**. The preference is stored locally and disables both UI
analytics and lifecycle analytics emitted by the local host. Website analytics does not use the
desktop preference. Mobile has its own phone-wide **Settings → General → Privacy → Share product
analytics** preference, independent of desktop and host collection. It defaults to enabled in a
configured production build, is read before collection starts, and remains disabled if the stored
preference cannot be read. Disabling it drops pending mobile events; it does not remove previously
received events or retract an in-flight request. There is no persistent offline analytics queue.
Development and preview mobile builds do not collect product analytics. Mobile sign-in uses the
same account ID and normalized email profile traits described above. Before mobile sign-in, up to
100 sanitized events stay in process memory for at most 30 minutes from the first buffered event.
They are sent once with their original timestamps after an account becomes available. Opt-out,
expiry, and process exit discard unclaimed events. The oldest event is removed when the buffer is
full. Sign-out ends the old account's operation scopes; later signed-out activity can be associated
with the next account that signs in. No anonymous mobile event is sent before that association.

Hosted Site analytics records only the operation, entry point, result, and bounded failure code. It
does not contain the site's URL, hostname, title, source path, site ID, or content. A one-time
backfill may update the email trait of an existing OpenPanel profile matched to a current account; it
does not create profiles for accounts without existing analytics activity.

OpenPanel event and profile data has no automatic retention limit. It remains stored until it is
removed manually or the analytics project is deleted. OpenPanel analytics does not change where
agent workspaces, conversations, attachments, browser data, and team data are stored.

## Data stored by the central account service

The account service runs on Cloudflare Workers. It uses Cloudflare D1 for structured records and
Cloudflare R2 for account avatar files.

The service stores:

- an account ID, normalized email address, identity key, optional name, optional avatar URL, and
  creation and update times;
- email sign-in challenges with the email address, hashes of the challenge ID, one-time code, and
  source IP address, attempt counts, and lifecycle times;
- account sessions with a session ID, account ID, token hash, creation time, last-use time,
  expiration time, and optional revocation time;
- rate-limit keys as hashes, their fixed window start time, and the attempt count;
- short-lived team authentication tickets with a ticket hash, account ID, team server ID, lifecycle
  times, and optional consumption time;
- remote host records with the owner, name, optional logo, device public key, and authorization epoch;
- remote memberships and invitations with roles, states, hashed invitation tokens, and lifecycle times;
- logical remote session records with the account, host, originating account-session hash, start,
  end, and expiration times;
- the current account avatar file and its content type when the user uploads an avatar.
- optional host logo files and their content types when the owner uploads a logo.
- published agent templates: the agent name, title, instructions, avatar, routine names, schedules
  and instructions, marketplace skill references, the `SKILL.md` text of local skills, the local
  agent ID, a share card image made from these fields, and creation and update times. Anyone
  with the link can read a template, and sites such as X show the share card when the link is
  posted. Unpublish removes the template content and its images. The service keeps the link ID,
  the account ID, the local agent ID and the unpublish time, so publishing the same agent again
  gives back the same link. Deleting the account removes them. Templates do not include
  workspace files, memories, conversations, or integration credentials.

The service does not store plaintext one-time codes, account session tokens, or team authentication
tickets in D1. It returns a new plaintext secret only to the client that requested it. The desktop
app encrypts its account session token with the operating-system storage protection before it writes
the token to disk.

Account avatar URLs are public, long-lived resources. A person who has the complete URL can request
the avatar without an account session.

## Central data retention

Cloudflare runs a maintenance task once each day. The task removes:

- sign-in challenges after they expire or are consumed;
- account sessions after they are revoked (older already-expired sessions are also removed);
- team authentication tickets after they expire or are consumed;
- rate-limit records after their 15-minute window ends.

These technical records are normally removed within 24 hours after they become inactive. A failed
maintenance run can keep them until a later successful run. The task logs only aggregate deletion
counts. It does not log account IDs, email addresses, IP addresses, tokens, or ticket values.

Replacing or deleting an account avatar or host logo removes the previous R2 object on a best-effort
basis. Account/device sessions and logical remote sessions deliberately have no time-based expiration.
Logout or device revocation ends access; removing a team membership ends access to that team.
Revoking an account/device credential disconnects its active remote sessions, without disconnecting
other authorized devices. Older remote sessions without a device binding are disconnected account-wide
on revocation. Short-lived QR codes and connection tickets still expire.
Settings → Profile → Account sessions lets you list and disconnect other desktop or mobile sign-ins.
Only device/session labels, IDs, sign-in times and last-activity times are returned, never credentials.
Mobile Settings can update your account name and photo through the same account API and list or
disconnect account sessions. The appearance preference is stored only on the phone.
After a profile change, the account API sends Signal a signed notification identifying the account.
Signal notifies only that account’s connected devices, without including the profile or credentials.
Devices check the profile and joined-server directory on a cold launch and every 15 minutes while active.
Returning from the background does not trigger an automatic check. On mobile, Notification Center and
other iOS `inactive` transitions do not count as leaving the app and do not reset the timer. Profile change notifications
can trigger an earlier refresh. These authenticated requests retrieve
account identity (name, email and avatar URL), not conversations or workspace content.

Mobile hidden and pinned chat preferences are stored on the phone, separately per account and server.
Conversation read/unread changes are stored on the desktop host and shared with your other connected devices.

Mobile chat uses a local symbol beside links. It does not fetch website icons or Markdown images
when displaying a conversation. Link destinations are contacted only when you choose to open them.

Mobile chat can send selected files to the conversation's desktop host through the existing encrypted
team connection. Text pasted into the input is processed only after the user pastes it. A text paste
longer than 4,000 characters becomes a text attachment. Selected documents can also have a temporary
copy in the phone's system cache. Attachments added while editing a queued message are saved in the
phone's app document storage, with references in the saved edit, so they survive an app restart.
Those draft copies are removed when the attachment is removed or the edit is saved or cancelled.
Uploads are limited to 10 MB per file on mobile; successful uploads
become managed attachments on the host. Camera capture uses an in-chat preview. Photo selection uses the phone's system interface.
Image attachment previews are downloaded from the desktop host through the same encrypted connection.
Other attachments are downloaded when you choose Open or save. The phone creates a temporary file for
the system share sheet and removes it when that sheet closes. The app you select can keep its own copy.
Cloudflare account storage does not receive these files.

Mobile dictation uses the phone's speech recognition only after you press the microphone. It asks
for on-device recognition. On iOS, this applies when the phone supports it for your language. On
Android, it applies when the language model is installed. Otherwise, or when on-device recognition
fails before it recognizes any speech, the phone's recognition service, Apple or Google, receives the
audio. The recognized text goes into the message field and is sent
only when you send the message. OpenBot does not store or send the audio.

## Email delivery and infrastructure providers

OpenBot sends sign-in and team invitation messages through the configured SMTP provider. The
provider receives the recipient address and the message content. A sign-in message contains the
one-time code and its expiration time. A team invitation can contain the inviter address, team name,
role, and invite URL. The HTML version of a message loads the OpenBot logo from `openbot.run` when
the mail client shows images. The image address is the same in every message and identifies no
recipient.

Cloudflare processes account and configuration API requests. It does not carry Team API, file,
message, command, Remote Desktop media, or Remote Desktop input traffic. Cloudflare and the email
provider can keep their own security, delivery, and network logs under their own policies. These
provider logs are outside the OpenBot application database and its daily maintenance task.

## Data stored on the OpenBot computer

- `~/OpenBot/Agents` contains one workspace per agent. A profile written by a release before the
  bot-to-agent rename holds them under `~/OpenBot/Bots`; the application moves them on first launch.
- `~/OpenBot/Shared` contains managed transfers shared between agents, and
  `~/OpenBot/Shared/Data/agent-data.db` holds the records the agents keep for themselves between tasks.
  Every agent on this computer can read and write every table in that file, and the user can delete any
  table in agent settings.
- `~/OpenBot/Downloads` contains files downloaded by the embedded browser.
- `~/Library/Application Support/OpenBot` contains the OpenBot SQLite database, agent metadata,
  conversations, message queues, direct messages, reactions, read state, attachment drafts and
  indexes, team configuration, local team members and sessions, the shared browser profile, cookies,
  application preferences, and the provider CLIs OpenBot downloads. The downloaded CLIs are kept in
  one store for the whole computer, which no other profile data shares.
- The local team configuration contains team member profiles, password hashes and salts when local
  password sign-in is used, invite and session token hashes, and the team identity key pair.
- `~/.codex` is owned by Codex CLI and contains its login and thread data. OpenBot does not copy or
  manage Codex credentials.
- `~/.claude` is owned by Claude CLI and contains its login and session data. OpenBot does not copy
  or manage Claude credentials.
- The MCP sign-ins are kept in `~/Library/Application Support/OpenBot`, encrypted by the operating
  system's secret storage in the same way as provider API keys. One record per server address holds
  the client registration and the access and refresh tokens. Removing the server in settings deletes
  its record. These values are redacted from logs, exports and diagnostics.
- `~/Library/Application Support/OpenBot/logs/trace.ndjson` is a local trace of IPC calls,
  provider turns, and main-process failures. Each line holds a time, the IPC channel name, the turn
  origin or the failure origin (`uncaughtException` or `unhandledRejection`), the duration, and the
  outcome word. The failure's error text goes only to the redacted log. The trace holds no payloads,
  messages, URLs, paths, or identifiers, and it goes through log redaction before it is written. It
  is kept to two files of 2 MB each and is never sent.

Attachments copied into OpenBot remain in managed storage after their original file is moved or
deleted. All agents share the embedded browser profile, including cookies and website sessions.

## Remote Team API

When the owner publishes OpenBot, the app starts an authenticated Team API on a localhost port. The
client and host use a separate OpenBot Signal service to establish WebRTC. Signal carries only
short-lived authentication, SDP, and ICE messages. Team API data uses WebRTC DataChannels. Remote
Desktop media and input use a separate WebRTC connection. The live browser view sends compressed
images of the host's browser tab, and the watching member's pointer and key input, over that same
media connection. ICE uses a direct peer-to-peer path when possible. If a direct path is not possible, encrypted WebRTC traffic uses an OpenBot coturn relay.

Agents, conversations, queues, direct messages, attachments, browser data, prompts, approvals, and
Remote Desktop data remain on the host. The central account service does not copy them into D1 or
R2. The Signal service does not proxy them or write them to logs. The host does not need a public
inbound port.

## Other network connections

Network traffic can also occur when:

- the local Codex App Server connects to OpenAI;
- the local Claude Agent SDK connects to Anthropic through Claude CLI;
- a user or an agent visits a page in the embedded browser;
- a user submits text that is not a web address in the browser address bar, which sends the query to Google Search;
- a locally installed Codex plugin connects to its service;
- an MCP server the user enabled is reached at its own address, and, when that server asks for a
  sign-in, OpenBot connects to the server's authorization service to register itself, to exchange
  the grant the browser returns, and to renew the token. Nothing about the user's agents,
  conversations or files is sent in those requests;
- an installed build checks GitHub Releases for updates;
- OpenBot checks for new provider CLI releases when it starts, once an hour, and when you select
  `Check for updates`. It asks `api.github.com` for Codex, `registry.npmjs.org` for Claude and
  OpenCode, and `x.ai/cli` for Grok, and it reads a list of blocked versions from
  `raw.githubusercontent.com/nightly-labs/openbot`. These requests contain no account, agent,
  conversation or file data;
- a user opens an explicitly labeled external support or setup link.

Plugin pages on openbot.run show each listing's own icon. The page asks `openbot.run` for that
picture, and the website fetches it there from the address the plugin catalog holds, so reading a
plugin page does not connect your browser to the plugin developer's servers.

Account usage shown in OpenBot is requested through the local Codex App Server. OpenBot does not send
that usage to its maintainer.

## Agent access

Agents currently use `danger-full-access` with `approvalPolicy: never`. They can read and modify local
files, run programs, use the network, and control the embedded browser without an OpenBot confirmation
dialog. This is an explicit product behavior, not a host security boundary. Keep backups and do not
give an agent a task you would not allow a local command-line tool to perform.

On first launch, OpenBot explains this access and does not start the agent services until you
explicitly accept it. The acceptance record stays in OpenBot's local application-support directory.

Computer Use is provided by `cua-driver`, a local binary that OpenBot ships and starts as its own
child process. It starts only when you open the Computer Use panel or an agent uses the function, and
it stops when OpenBot stops. Because OpenBot starts it directly, macOS attributes the Screen Recording
and Accessibility grants to OpenBot, and macOS keeps control of the prompts. Windows and Linux ask for
no such grant. Screen contents and accessibility trees that an agent reads through the driver go to
that agent's provider, the same as any other message content.

The driver is third-party software with its own product analytics, which its vendor turns on by
default and which are not OpenBot's. They would send the driver version, the operating system, a
random installation identifier, and a bucketed record of each tool call to that vendor. They never
send screen contents, window or application names, typed text, or the content of a tool result.

On its own the driver also asks GitHub for a newer release each time it starts.

**OpenBot stops both calls, always.** Every copy of the driver OpenBot starts gets
`CUA_DRIVER_RS_TELEMETRY_ENABLED=0` and `CUA_DRIVER_RS_UPDATE_CHECK=0`, so it sends the vendor
nothing and asks GitHub nothing. OpenBot pins the driver version it packages, so a release check
could only offer you an update OpenBot would refuse. The driver reads the environment before its own
configuration, and OpenBot sets both variables last, so nothing can turn them back on for a driver
OpenBot started. OpenBot writes no file, so a driver you run yourself keeps the settings you gave
it.

Auto approve also permits that agent to publish, update and delete public hosted sites without
another confirmation. Turbo mode extends this permission to every agent on that host. Publishing
makes the selected site content publicly accessible. Without either grant, hosted-site changes
require confirmation. Site ownership and source validation still apply.

## Exports

The account menu can export a local ZIP containing agent profiles, conversation snapshots, queues,
and managed message attachments. It intentionally excludes CLI credentials, browser cookies, and
agent workspace files.

The diagnostics export contains application and CLI versions, capability states, aggregate queue
counts, and a summary of the local trace: counts, outcomes, and durations for each IPC channel,
turn origin, and failure origin. It contains no conversations, visited URLs, account email, file
contents, or local file paths.

## Delete local data

Quit OpenBot, then remove the OpenBot folders listed above. Removing
`~/Library/Application Support/OpenBot` also removes the embedded browser's cookies and logins.
Removing `~/OpenBot` removes agent workspaces, transfers, downloads, and the records the agents kept. OpenBot does not delete
`~/.codex` or `~/.claude`; use each CLI's own controls if you also want to remove its local data.

Review folders before deleting them and keep a backup of anything you need.

## Questions

Use [GitHub Discussions](https://github.com/nightly-labs/openbot/discussions) for privacy questions.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), without attaching
credentials, conversations, or unrelated private files.

When you ask OpenBot to generate or revise an agent profile, it sends your setup
prompt, the current profile draft (when present), and available sidebar section
names and identifiers to the selected AI provider through its local CLI. This
request does not include conversation history, saved memories, or workspace files.
The draft is reviewed before OpenBot saves it; generating a draft does not create
an OpenBot conversation or change an existing agent. The provider's own data and
CLI retention policies still apply.

Publishing an agent template from the chat makes its instructions, skills, and routines public to
anyone with the link at `openbot.run/agents/<id>`, with your account name as the creator. OpenBot
stops the publish when a text field looks like a secret. Workspace files and memories are not sent.

Marketplace submissions from the desktop app show the publisher’s current account photo publicly on the listing. Account photo updates appear on the listing; removing the account photo removes it from the listing. Private memories and integration credentials are not included.

### OpenCode

OpenBot downloads the OpenCode CLI from `registry.npmjs.org` and its license from
`github.com/anomalyco/opencode`, then starts it with `opencode acp`. Prompts, attachments, and tool
results go to that local process. OpenCode can send them to the model provider selected in its
configuration. OpenCode's free models are the default, and they reach OpenCode Go with no account,
so a first OpenCode turn leaves this computer without a sign-in.

An OpenCode Go key is optional and unlocks the paid catalog. OpenBot encrypts it with the operating
system's secret storage, writes it to a file that only your user account can read, and passes it
only to the local OpenCode process. No screen, log, data export, or diagnostics report contains it;
the data export lists it under `scope.excludes`. OpenBot does not copy OpenCode credentials or
upload its session files. OpenCode manages its own login and resume state.

## Shared desktop channels

Channel names, purposes, participating agents, linked conversation references, messages, tasks,
assignment records, history summaries, and human read positions are stored in the host's SQLite
database. All authenticated members of that server can read and use its channels. Agent membership
selects participating agents; it is not a separate human access boundary.

The selected lead's provider receives relevant channel content for routing and history summaries in
separate sessions without work tools. Assigned agents receive the channel purpose, responsibilities,
request, relevant source messages, shared history summary, recent messages, and attachment references.
Agents can retrieve earlier channel messages and other conversations on that server when needed.
Unrelated conversations are not sent automatically. Provider session internals remain internal.
The provider's own data policies apply to content it receives.

Archiving a channel stops its work and retains its transcript. Restore makes the channel available again.
These actions do not remove agents, their memories, or linked conversations. Channel traffic between
desktop clients and a host uses the existing host transport. The account API and Signal service do
not store channel chats or make routing decisions. This feature adds no mobile chat interface.

## Mobile queue drafts

A phone stores the text and attachment references of an active queue edit in its secure local
storage, and keeps a copy of each file the edit adds in its own application storage, so it can
recover the edit after navigation or restart. These copies stay on the phone and are removed when
the edit is saved or cancelled. The host keeps the original message and a persistent edit hold
until the edit is saved, cancelled, or the message is deleted.

The desktop editor also keeps its active queue edit, attachment references, and edit identity in
local application storage. This lets it recover the held draft after restart. Neither client
releases the host hold merely because the editor closes or disconnects. The host also preserves
attachment drafts released by edit cancellation or message deletion until they are sent or
discarded. This lets a disconnected desktop recover its saved composer backup after host restart.

## Optional macOS Host Manager

An administrator can install a local Host Manager for several native macOS users. It reads only
registered UIDs, process IDs, application versions, restart readiness, timestamps, and health
booleans through separate local status directories. It does not read or back up tenant homes,
workspaces, databases, provider directories, browser data, or conversations. It requests release
metadata and application downloads from the fixed OpenBot GitHub repository; those requests
expose the host's network address to GitHub. It sends no tenant status or tenant content to GitHub.

The separate, optional administrator account-setup command creates new local Standard users and
empty private homes. It saves generated login passwords in a root-only file under
`/private/var/root` for the administrator to retrieve. It does not transmit those credentials or
include them in logs. The installed administrator CLI shows each password once on the controlling terminal after setup,
then removes the recovery file. A failed setup retains that root-only file for administrator recovery.
The administrator controls secure password delivery. Host verification reads home metadata only
and tests cross-user access using harmless temporary files outside tenant homes.

### Remote desktop setup diagnostics

When an authenticated server member checks remote desktop setup, the host sends its computer name,
macOS account name, permission and service results, active session count, and check time to that member.
A live test also sends a temporary four-digit code and mouse and keyboard test results. These results
stay in memory and are not sent to analytics. Screen video uses the existing remote desktop connection.
Permission approval remains in macOS System Settings on the host.

## Secure browser authentication

Passwords, email/SMS codes, and authenticator codes entered in a secure chat card are sent to the
shown HTTPS site for one submission. Connected desktop and mobile clients send the value through
the authenticated Team API to the computer running the browser. The handoff does not add the value
to chat, provider tool arguments, diagnostics, analytics, or a credential store. Input and submission
values are held in memory for the operation; cancellation and submission clear the input.

OpenBot blocks agent browser access while consent is pending. Before entering a submitted value, it
blocks image capture and live browser streams, and stops
and discards the active browser recording before entry. After entry, protection stays until the
browser replaces the document. After a same-page submission, OpenBot clears the filled fields and,
when the value no longer appears in the page title, address, text, field values, or attributes, keeps
the page, so a later login step on the same page stays available. Page code can still hold the
value, so page evaluation and recording stay blocked in that tab and its connected popup or opener
tabs until the page navigates. Otherwise OpenBot loads the current URL as a new
document with a GET request instead. Failed submission or reload requires manual takeover. Recording does not restart
automatically, and the tab's back/forward history is cleared after replacement to prevent restoring
the sensitive document. The destination site receives the value and controls its own processing.
This protection does not isolate credentials from the operating system or agents with unrestricted
machine access. Values pasted into ordinary chat are not covered by secure handoff.
