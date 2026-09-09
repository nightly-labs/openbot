# Privacy

OpenBot is local-first, but it is not offline-only. Agent workspaces, conversations, attachments,
browser data, and team data stay on the computer that runs OpenBot. The optional OpenBot account
service stores the minimum central data needed for email sign-in, account avatars, remote host
configuration, memberships, invitations, and logical sessions.

Production builds of OpenBot and the website use a self-hosted OpenPanel service for product
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

Analytics events do not contain message or direct-message text, prompts, replies, generated content,
search queries, embedded-browser URLs or page titles, file names, local paths, commands, raw error
messages, or local identifiers for agents, threads, turns, messages, servers, and team members.
Website page views do not contain query parameters, hashes, or invitation values. Session replay and
automatic interaction capture are disabled.

When a user signs in, OpenPanel receives the OpenBot account ID and normalized account email so UI
actions can be associated with the account that started them. The email is stored on the OpenPanel
profile and is not copied into individual event properties. Agent lifecycle events are emitted once
by the local host and associated with the host owner's account; clients that observe a remote host do
not emit the lifecycle again. Sign-in attempts and website activity remain anonymous until an account
has been verified. Landing-page attribution includes an allowlisted source category, an allowlisted
platform name (or unknown), and the referring domain when available. A recognized utm_source tag
takes precedence over the referring domain for platform classification; unrecognized tags are not
sent. Attribution excludes referrer paths, query parameters, fragments, credentials, ports, and raw
campaign URLs. Referrals from openbot.run and its subdomains are omitted. OpenPanel can also derive
session, device, browser, operating-system, network, and approximate geographic metadata from a
request. The analytics service runs on OpenBot's self-hosted infrastructure and receives events
through `analytics.openbot.run`.
Analytics is enabled in production by default. Desktop users can disable it under **Settings →
General → Privacy → Share product analytics**. The preference is stored locally and disables both UI
analytics and lifecycle analytics emitted by the local host. Website analytics does not use the
desktop preference.

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
copy in the phone's system cache. Uploads are limited to 10 MB per file on mobile; successful uploads
become managed attachments on the host. Cloudflare account storage does not receive these files.

## Email delivery and infrastructure providers

OpenBot sends sign-in and team invitation messages through the configured SMTP provider. The
provider receives the recipient address and the message content. A sign-in message contains the
one-time code and its expiration time. A team invitation can contain the inviter address, team name,
role, and invite URL.

Cloudflare processes account and configuration API requests. It does not carry Team API, file,
message, command, Remote Desktop media, or Remote Desktop input traffic. Cloudflare and the email
provider can keep their own security, delivery, and network logs under their own policies. These
provider logs are outside the OpenBot application database and its daily maintenance task.

## Data stored on the OpenBot computer

- `~/OpenBot/Agents` contains one workspace per agent. A profile written by a release before the
  bot-to-agent rename holds them under `~/OpenBot/Bots`; the application moves them on first launch.
- `~/OpenBot/Shared` contains managed transfers shared between agents.
- `~/OpenBot/Downloads` contains files downloaded by the embedded browser.
- `~/Library/Application Support/OpenBot` contains the OpenBot SQLite database, agent metadata,
  conversations, message queues, direct messages, reactions, read state, attachment drafts and
  indexes, team configuration, local team members and sessions, the shared browser profile, cookies,
  and application preferences.
- The local team configuration contains team member profiles, password hashes and salts when local
  password sign-in is used, invite and session token hashes, and the team identity key pair.
- `~/.codex` is owned by Codex CLI and contains its login and thread data. OpenBot does not copy or
  manage Codex credentials.
- `~/.claude` is owned by Claude CLI and contains its login and session data. OpenBot does not copy
  or manage Claude credentials.

Attachments copied into OpenBot remain in managed storage after their original file is moved or
deleted. All agents share the embedded browser profile, including cookies and website sessions.

## Remote Team API

When the owner publishes OpenBot, the app starts an authenticated Team API on a localhost port. The
client and host use a separate OpenBot Signal service to establish WebRTC. Signal carries only
short-lived authentication, SDP, and ICE messages. Team API data uses WebRTC DataChannels. Remote
Desktop media and input use a separate WebRTC connection. ICE uses a direct peer-to-peer path when
possible. If a direct path is not possible, encrypted WebRTC traffic uses an OpenBot coturn relay.

Agents, conversations, queues, direct messages, attachments, browser data, prompts, approvals, and
Remote Desktop data remain on the host. The central account service does not copy them into D1 or
R2. The Signal service does not proxy them or write them to logs. The host does not need a public
inbound port.

## Other network connections

Network traffic can also occur when:

- the local Codex App Server connects to OpenAI;
- the local Claude Agent SDK connects to Anthropic through Claude CLI;
- a user or an agent visits a page in the embedded browser;
- a locally installed Codex plugin connects to its service;
- an installed build checks GitHub Releases for updates;
- a user opens an explicitly labeled external support or setup link.

Account usage shown in OpenBot is requested through the local Codex App Server. OpenBot does not send
that usage to its maintainer.

## Agent access

Agents currently use `danger-full-access` with `approvalPolicy: never`. They can read and modify local
files, run programs, use the network, and control the embedded browser without an OpenBot confirmation
dialog. This is an explicit product behavior, not a host security boundary. Keep backups and do not
give an agent a task you would not allow a local command-line tool to perform.

On first launch, OpenBot explains this access and does not start the agent services until you
explicitly accept it. The acceptance record stays in OpenBot's local application-support directory.

Computer Use is provided by a separately installed local Codex plugin. macOS permission prompts and
any plugin safety hand-offs remain controlled by macOS and that plugin.

## Exports

The account menu can export a local ZIP containing agent profiles, conversation snapshots, queues,
and managed message attachments. It intentionally excludes CLI credentials, browser cookies, and
agent workspace files.

The diagnostics export contains application and CLI versions, capability states, and aggregate queue
counts. It contains no conversations, visited URLs, account email, file contents, or local file paths.

## Delete local data

Quit OpenBot, then remove the OpenBot folders listed above. Removing
`~/Library/Application Support/OpenBot` also removes the embedded browser's cookies and logins.
Removing `~/OpenBot` removes agent workspaces, transfers, and downloads. OpenBot does not delete
`~/.codex` or `~/.claude`; use each CLI's own controls if you also want to remove its local data.

Review folders before deleting them and keep a backup of anything you need.

## Questions

Use [GitHub Discussions](https://github.com/NorbertBodziony/openbot/discussions) for privacy questions.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), without attaching
credentials, conversations, or unrelated private files.

When you ask OpenBot to generate or revise an agent profile, it sends your setup
prompt, the current profile draft (when present), and available sidebar section
names and identifiers to the selected AI provider through its local CLI. This
request does not include conversation history, saved memories, or workspace files.
The draft is reviewed before OpenBot saves it; generating a draft does not create
an OpenBot conversation or change an existing agent. The provider's own data and
CLI retention policies still apply.

Marketplace submissions from the desktop app show the publisher’s current account photo publicly on the listing. Account photo updates appear on the listing; removing the account photo removes it from the listing. Private memories and integration credentials are not included.

### OpenCode

OpenBot starts the OpenCode CLI installed on the host with `opencode acp`. Prompts, attachments,
and tool results go to that local process. OpenCode can send them to the model provider selected
in its configuration. OpenBot does not copy OpenCode credentials or upload its session files.
OpenCode manages its own login and resume state.
