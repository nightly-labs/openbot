# Privacy

OpenBot is local-first, but it is not offline-only. Agent workspaces, conversations, attachments,
browser data, and team data stay on the computer that runs OpenBot. The optional OpenBot account
service stores the minimum central data needed for email sign-in, account avatars, remote host
configuration, memberships, invitations, and logical sessions.

The optional browser client at `/app` connects to the computer that runs OpenBot. Conversation
and attachment data travel through the existing encrypted host connection, not through the
account Worker. The browser keeps chat pages, drafts, search results, and file previews in memory;
it does not create a persistent offline chat cache. Files that the user downloads are saved by
their browser. The host must stay online. An owner or admin can manage members and invitations from
the browser; these requests go to the account Worker, as they do from the desktop app. A signed-in
user can also change the display name and avatar and disconnect account sessions from the browser;
these requests and the avatar image go to the same account Worker as from the desktop app. Host
settings, such as MCP servers and the server's hosted sites, travel through the encrypted host
connection. A hosted site belongs to the server that published it. When the computer that runs
OpenBot is a registered server, its site requests to the account Worker also send that server's id and
machine token. The account Worker already holds both, and uses them only to find the server and its
plan's site limit.
A Grok Bot export that a member imports into a joined server, from the desktop app or the browser, goes
to the computer that runs that server through the same encrypted host connection, not through the
account Worker. The host keeps the file only until the import ends, is cancelled, or expires.
When an owner or admin signs in to an MCP server, a provider or a connector of a joined server, or
opens a sign-in link that an agent of that server showed, the sign-in page can open in the browser
of their own computer. That computer then sends the address the page returns to, which holds the
sign-in code, to the host through the same encrypted host connection, not through the account
Worker. A Slack or Discord install sends its sealed grant to the host on the same path; the user's
computer cannot open it. Neither computer logs the code, and the host keeps the grant.
When a member of a joined server selects "Sign in on this computer" in that server's browser, the
desktop app opens the site in a window on their computer, with a session in memory only. When the
window finds a completed sign-in, or when the member selects Done, it sends the cookies of that site,
and of no other site, to the host through the same encrypted host connection, not through the account
Worker. The host sets them in the browser session of the tab: the shared session, which every agent
and member of the server can use, the session of an agent that has a browser session of its own, or
a named browser profile, which every agent assigned to that profile can use.
When the server tab still shows a sign-in step, the app also sends the address of the window's page,
and the server tab opens it.
Neither computer logs the cookie values. The desktop app then removes the window's session.
To show each server's state, the browser also keeps a status connection to each host of the account
that no tab has open, as the mobile app does; the host then shows the member as present. Host logos
come from the account Worker to members of the host, and the browser can cache them.

Browser email sign-in uses a persistent host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie.
Browser JavaScript cannot read the account credential. Trusted host public keys are stored in
local storage separately for each account. The shared file preview can also store its panel width.
The sidebar stores pinned agent and channel ids, collapsed section ids, and the selected channel id
for each account and host. The server rail stores the order of host ids for each account. The
browser also stores the chosen interface language and whether the completion sound is on. It stores
no message content.
Signing out revokes that credential's remote sessions and tells other open tabs to clear private
state. Host identity pins remain so a later sign-in cannot silently trust a replacement host key.
The web client records the product events that "Product analytics" describes. At sign-in it sends the saved first website visit
of the browser, described in "Product analytics", to the account service. It does not send email codes, credentials,
message content, file content, or search queries to telemetry.

Production builds of OpenBot desktop, the browser client at `/app`, the configured mobile app, and the website use a
self-hosted OpenPanel service for product analytics. Development builds, previews, tests, and Storybook do not send analytics.

The production account service also sends OpenPanel an event when a paid plan or a hosted server
changes: a Checkout starts or expires, a plan starts, changes, is cancelled or ends, a payment
succeeds or fails, a payment is refunded or disputed, the Customer Portal opens, or a hosted server is set up, fails to set up, stops
after no use, starts, changes its machine, stops at the end of its plan, is renewed or is deleted.
It also sends these events for a license: a Checkout starts, the license starts, its number of
users goes up or down, its renewal is cancelled or resumed, it ends, or its payment succeeds, fails,
is refunded or is disputed.
Each event has your account ID and only fixed values: the action, whether it is a server plan or a
license, the plan, the number of license users, the billing period, the currency, the amount that
Stripe reports, the place in the app where the plans were opened, the server size, the start reason
and an error code. It has
no email, name, Stripe ID or server ID. The desktop analytics setting does not stop these events,
because the account service sends them and not your computer.

For each email that the account service sends from its mailbox (a sign-in code, an invitation, a contact
message or a welcome email), it sends OpenPanel one event with the kind of email and the result of the send. This
event has no account ID, email address, name or message content.

The account service also records a return from Checkout without payment and later payment
recovery. Verified paid invoices produce a revenue event in USD, with the original amount,
currency, and dated exchange rate. Refunds and disputes produce an event with the same USD amount,
currency, and dated exchange rate. Daily totals contain recurring revenue, overdue recurring
revenue, paid accounts, paid servers, scheduled cancellations, and license recurring revenue,
accounts and users. These totals have no account ID.
The service stores payment facts and a delivery ledger in D1 to prevent duplicate revenue events.
It does not send Stripe identifiers, server identifiers, or Checkout return tokens to OpenPanel.
An account deletion clears its profile reference and stops pending account event delivery.
The account service also sends an event when it makes a new account (with the app used to sign in)
and when it saves the first website visit of an account. A payment event and a revenue event include
that first visit when the account has one.

## AI conversation context

When a provider session is replaced, OpenBot sends a bounded excerpt of the current conversation
to the selected provider. The agent can request older messages from that same conversation through
local history tools. Requested text and selected saved work steps are then sent to that provider.
These tools exclude messages before the latest context reset and cannot search another conversation.
Channel history keeps its existing membership and task checks. Messaging history stays within its
current link. The full conversation stays in local SQLite storage. No history text is sent to the
account service or analytics by these tools.

## Local scripts

Local scripts is off by default for each agent. When enabled, scripts that run as the same OS user
on the host can read a local token and use the loopback API. They can send messages, run routines,
read pending questions and approvals, and submit answers or approval decisions. OpenBot redacts
secrets in API responses. Secret questions and browser takeovers return notices only and must be
completed in OpenBot. OpenBot does not send these API responses to the account service or analytics.
A script can send the data elsewhere under its own configuration.

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
reads. These records stay on the host and are not stored by the account service or Signal
service. Product analytics sends only the token counts of each completed turn and of each
provider and model in it, as "Product analytics" describes; it does not send the records, cost estimates or identifiers. Conversation clearing retains usage;
agent deletion removes it. A duplicate agent starts with no usage history.

Authenticated members of a host team can also see that host's storage through the Team API: how
much disk space each location, agent and chat uses, and the name, size, type, date and chat title of
each sent or generated file. They can also read the free and total size of the disk that holds the
host's OpenBot data. The response contains no file paths, and workspace and download files
are counted only as totals. Only owners and admins can delete a file or clear caches and logs. A
deleted file is removed from the host's disk; the message that sent it stays and shows that the file
is not available.

Costs are API-equivalent estimates in USD, not subscription charges. Missing usage, unknown prices,
and incomplete billing inputs remain marked as unavailable or partial.

## Product analytics

The production website records anonymous page views using only fixed paths: `/`, `/join`, the
download pages, the news and guide indexes, and published articles. It also records download clicks,
clicks on allowlisted public links, invitation validity, and open-app actions on invitation pages.
It also records the topic and result of a contact form send, and whether a return from Stripe
completed or was cancelled, for a plan, a license or the billing portal. The contact form message,
name and email are not sent to analytics.
The production desktop app records application, sign-in, onboarding, agent, message, turn, prompt,
approval, queue, routine, workflow, team, browser, search, Remote Desktop, update, marketplace, memory,
provider, voice transcription, Voice pane, spoken reply, voice model download, spoken reply setting,
reaction, Hosted Site, hosted server offer, hosted server plans, plan and member limits, license,
contact sales, provider usage limit, agent template, phone connection, connector, Computer Use
permission, help link, channel, server export and import, Usage view, and confirmed
application-version-change actions. Plans and license events send the plan, billing interval,
currency, where the plans were opened, and whether a license user count went up or down; they do
not send a price, a payment detail or a Stripe ID. Connector events name only the connector type,
such as Slack; channel events send no channel name. Message events can send the kinds of the
attached files (image, document, spreadsheet, ZIP or other), never their names or types. Event properties are limited to metadata such as counts, result states, timing, provider,
model, reasoning effort, application version, operating system, and coarse failure codes. Voice events
send only lengths, times, counts, the chosen voice (for example `F1`), whether the server is local or
remote, and whether speech recognition runs on the computer or in the cloud. They never send what
the user said, the reply, a transcript, or audio.

The production browser client at `/app` on `https://openbot.run` records the same product events
as the desktop app, with the same limits, and labels them as web. Its **Share product analytics**
setting in account settings controls these events and the error reports.

The configured production mobile app records app opens and foreground returns, sign-in QR pairing
and camera-permission outcomes, host connection attempts and losses, conversation-load outcomes,
message and prompt-answer submissions, attachment operations, agent/routine/memory actions,
server selection/join/leave, search result counts, pin/unpin, hide/unhide, Usage views and sign-out.
It also records email sign-in steps, whether pairing started from a QR code or a link, hosted
server plans views, setup steps, notification settings and the notification permission result,
Live Activity starts and ends, voice conversation and spoken turn outcomes, agent template
installs, and Marketplace installs (agent, skill or app, and the result; no listing name).

The mobile Marketplace reads the public catalog and the plugin app icons from the account service,
without account credentials. The phone sends no request to a plugin vendor until the user connects
that vendor's app. A key the user types, or the grant of a browser sign-in, goes only to the user's
own host over the encrypted Team channel.
Mobile properties include app version/build, iOS or Android, result, timing, bounded connection stage,
counts, coarse attachment size buckets, and provider/model/reasoning metadata where available.
Mobile never sends scanned QR values, install-referrer URLs or route identifiers. It does not
emit host lifecycle events again. Agent/host token and cost reports remain separate local data.

Analytics events do not contain message or direct-message text, prompts, replies, generated content,
search queries, embedded-browser URLs, paths or page titles, file names, local paths, commands, raw
error messages, or local identifiers for agents, threads, turns, messages, servers, and team members.
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
the path of a news article, guide or comparison published on openbot.run, together with the collection name, the
reading position reached (start, half, or end), and the section of the page a link was clicked in.
That path is a published article address and nothing else: it is matched against the site's own list
of articles, so no other part of a visited URL can be reported through it. Reading position is taken
from where the article sits on screen, never from how long it was open. Referrals from openbot.run and its subdomains are omitted.
The production website also saves the first visit of the browser in its `localStorage`: the source
category, the platform name, the first website page, the day, and the allowlisted campaign tags.
It saves no referrer, IP address or identifier. A later visit does not change it, and it is not used
after 90 days. When you sign in on the web, or open the page after a desktop checkout in the same
browser, the browser sends it to the account service. The account service keeps the first one that
it gets on your account and sends it to OpenPanel with your account ID. To remove it from a
browser, clear the site data of openbot.run. OpenPanel can also derive
session, device, browser, operating-system, network, and approximate geographic metadata from a
request. The analytics service runs on OpenBot's self-hosted infrastructure and receives events
through `analytics.openbot.run`.
Analytics is enabled in production by default. Desktop users can disable it under **Settings →
General → Permissions → Share product analytics**. The preference is stored locally and disables both UI
analytics and lifecycle analytics emitted by the local host. Website analytics does not use the
desktop preference. Mobile has its own phone-wide **Settings → Privacy → Share product analytics**
preference, independent of desktop and host collection. It defaults to enabled in a
configured production build, is read before collection starts, and remains disabled if the stored
preference cannot be read. Disabling it drops pending mobile events; it does not remove previously
received events or retract an in-flight request. There is no persistent offline analytics queue.
When a user turns product analytics off on desktop, web or mobile, the app first sends one event
that says analytics was turned off, then stops. Turning it on again sends nothing.
Development and preview mobile builds do not collect product analytics. Mobile sign-in uses the
same account ID and normalized email profile traits described above. Before mobile sign-in, up to
100 sanitized events stay in process memory for at most 30 minutes from the first buffered event.
They are sent once with their original timestamps after an account becomes available. Opt-out,
expiry, and process exit discard unclaimed events. The oldest event is removed when the buffer is
full. Sign-out ends the old account's operation scopes; later signed-out activity can be associated
with the next account that signs in. No anonymous mobile event is sent before that association.

The local host also records how the agents are used:

- **Websites.** When a page in the embedded browser reaches a new registrable domain, the host sends
  that domain (for example `linkedin.com` for `www.linkedin.com`) and whether the user or an agent
  opened it. It never sends the subdomain, path, query, fragment or page title. A subdomain under a
  shared suffix is reduced to that suffix, so `user.github.io` is sent as `github.io`. IP addresses,
  single-label names, `localhost`, and names with no public suffix (for example `.local`, `.lan`,
  `.internal` or `.home.arpa`) are not sent.
- **Tools.** When a turn completes, the host sends one count per kind of tool the agent used (for
  example command, file change, web search, browser, or MCP), how many of those calls failed (Claude
  does not report failed tool calls, so its count is 0), and
  the plugin: the slug of an OpenBot catalog plugin, `builtin` for OpenBot's own tools, or `custom`.
  The tool name is sent only for OpenBot's own tools and catalog plugins. The name, address and
  command of a server the user added, the tool arguments and the tool results are not sent.
- **Routine runs.** The host sends the outcome of a routine run, whether it was scheduled or manual,
  and its schedule type (for example daily or weekly). The routine name and instruction are not
  sent.
- **Workflow runs.** When a workflow run ends, the host sends its outcome, how it started (for
  example manual, schedule or webhook), its duration, and the count of steps that ran, by kind
  (agent, model, approval, output). The workflow name, the step text and the IDs are not sent.
- **Setup.** At most once a day, the host sends counts of agents, enabled routines, workflows,
  custom MCP servers, local skills and community skills; the slugs of enabled catalog plugins and of
  curated skills and agents; the providers in use; and whether Computer Use is enabled.
- **Resource use.** At most once a day, the host sends a summary of the previous day: the memory and
  CPU use of OpenBot's process groups (main, windows, browser tabs, GPU, the database and voice
  processes) and of each provider's CLI and its child processes, by provider id; the main process
  responsiveness; agent database statement times and counts; counts of processes that stopped
  unexpectedly, by reason; and the computer's memory and processor class, architecture, and whether
  it is a server. Memory is rounded to 50 MB. Process IDs, program names, command lines and paths
  are not sent. A day that ends while analytics is off is not sent.
- **Token counts.** When a turn completes, the host sends the token counts that the provider
  reported for that turn: uncached input, cached input, cache write, output, and their total. These
  come from the same records as the Usage view. When the provider reported no usage, the host sends
  that the usage is unknown, not a count of 0. A count that the provider did not report is not sent.
  The host also sends the same counts for each provider and model that the turn used, with that
  provider and model name. The turn's messages and the provider's raw response are not sent.
- **Agent source.** Turn events say whether the agent came from a curated listing, a community
  listing, or neither, and name only a curated listing. Marketplace events name only a curated
  skill, agent or catalog plugin.
- **Payment type.** Turn events say how the turn is paid for: a provider plan, a saved API key, a
  free model, an endpoint that the user added, or unknown. The host reads this from the sign-in type
  that the provider's CLI reports and from whether a key is saved. It does not send the key, the
  account, or the name of the plan.

Hosted Site analytics records only the operation, entry point, result, and bounded failure code. It
does not contain the site's URL, hostname, title, source path, site ID, or content. A one-time
backfill may update the email trait of an existing OpenPanel profile matched to a current account; it
does not create profiles for accounts without existing analytics activity.

OpenPanel event and profile data has no automatic retention limit. It remains stored until it is
removed manually or the analytics project is deleted. OpenPanel analytics does not change where
agent workspaces, conversations, attachments, browser data, and team data are stored.

## Data stored by the central account service

The account service runs on Cloudflare Workers. It uses Cloudflare D1 for structured records and
Cloudflare R2 for files: account avatars, host logos, published hosted site files, marketplace skill
bundles and icons, and the images of published agent templates.

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
- the first website visit of an account, when a browser sends it: the source category, platform
  name, first website page, day, allowlisted campaign tags, whether it came from a sign-in or a
  checkout, and the save time. Deleting the account removes it.
- webhook routes: for each webhook routine and each workflow webhook trigger of a host, the opaque
  route ID, the host ID, the owner account ID, the link time, and the revocation time. When the
  routine or workflow stops using a route, or the host is deleted, the service sets the revocation
  time and the route stops working. The service
  keeps the row with these fields permanently, so that the old public URL never belongs to another
  host. It does not store the routine, the workflow, the secret, or request bodies.
- published agent templates: the agent name, title, instructions, avatar, routine names, schedules
  and instructions, marketplace skill references, the `SKILL.md` text of local skills, the local
  agent ID, a share card image made from these fields, and creation and update times. Anyone
  with the link can read a template, and sites such as X show the share card when the link is
  posted. Unpublish removes the template content and its images. The service keeps the link ID,
  the account ID, the local agent ID and the unpublish time, so publishing the same agent again
  gives back the same link. Deleting the account removes them. Templates do not include
  workspace files, memories, conversations, or integration credentials.
- billing records when the account starts a paid plan: the Stripe customer ID, and for
  each subscription the Stripe subscription ID, plan, billing period, currency, price, status, period end,
  and whether it ends at the period end. For a license, it keeps the same fields and the number of
  users in place of the plan. The service also keeps the ID, type and receive time of each
  Stripe webhook event for 7 days, to ignore a repeated event. These records hold no card data.
- hosted sites: the hostname, title, description, framework, state, owner account ID, lifecycle
  times, and for each deployment the file list, sizes and content types. The published site files
  are in R2. Anyone can read a published site. Deleting a site removes its files.
- marketplace skills: the owner account ID, name, description, category, review state, version
  records, install counts, and the skill bundle and icon in R2.
- reports about a hosted site: the hostname, the reason, the optional details text, a keyed hash of
  the source address (of its /64 for IPv6) for each day, the review state and the creation time.

The service does not store plaintext one-time codes, account session tokens, or team authentication
tickets in D1. It returns a new plaintext secret only to the client that requested it. The desktop
app encrypts its account session token with the operating-system storage protection before it writes
the token to disk.

The desktop app also keeps, for each joined server, the ID of its logical remote session and the
Signal address, so that the next start asks only for a new ticket. The file
(`openbot-remote-sessions-v1.bin`) is encrypted with the same storage protection and is not written
when that protection is unavailable. It names only the account that signed in. A session ID gives no
access without that account's session token. The app removes the file at sign-out or when another
account signs in, when it starts with no account signed in, and forgets a server's session when it
disconnects from the server or removes it. When the app quits, the session stays open in the account
service for the next start; signing out or disconnecting the device's sign-in ends it, as before.
Settings → General → Fast connection to servers turns this off. Off, the app removes the file at
once, keeps nothing on disk, and ends each session when it quits. Turned on during a run, it keeps the
sessions that are open at that time. The setting is on by default and is stored
in `openbot-remote-session-reuse-preference-v1.json`.

Account avatar URLs are public, long-lived resources. A person who has the complete URL can request
the avatar without an account session.

## Hosted servers

Each account can buy hosted servers. A hosted server is a Linux
OpenBot computer that runs in a [boat](https://boat.dev) sandbox in the EU (Germany, Finland or
France). The sandbox holds the server's workspaces, conversations, attachments, browser data and
team data, the same as your own computer would. The server stops 15 to 30 minutes after its last use and
starts again when you press a key or click in an app that shows it, when a Slack, Discord or
Telegram message addresses OpenBot, or a few minutes before its next scheduled routine run. Use means that an agent works, a remote desktop is open, a file moves, or you
sent a message, made a change, typed or used a shared browser view in the last 5 minutes. An app
that has focus (a focused window or tab, or the phone app in the foreground) also counts, for at
most 30 minutes after your last message, change or typing, or after you return to the app. The app
tells only the server that it
has focus; the account service gets no new data. An app that is only open without focus does not count.
To show whether a server is asleep, the app asks the account service for its state. This request
stores nothing. When boat stops the sandbox, boat keeps a snapshot of its disk until
the server starts again. Deleting the server
deletes the sandbox. A hosted server updates itself: it downloads the newest release from GitHub
Releases, as an installed build does, installs the Ubuntu packages that the release needs from the
Ubuntu package servers, and starts it at its next start, or when a member with update access installs
it from Server Settings.

For each hosted server, the account service stores the owner, name, size and the size of a pending
plan change, the plan, billing interval and currency, the open Stripe Checkout session ID, desired
and reported state, a reason code when the server fails to start, the reason for its last start, the
boat sandbox ID, a hash of the setup claim with its expiry and first-use times, the ID of the account
session that the server signed in with, the time of its last use, the end of its boat stop timer, the time of
its next scheduled routine run (not the routine or its instructions), and creation, update and deletion times. After a
server is deleted, its record stays so that the service never loses track of a sandbox. It also
stores the ID and receive time of each boat webhook delivery for 7 days. The account service does
not receive the server's conversations, files or commands, and its boat key cannot read them.

The account service gives each sandbox a name in boat, so that an operator can find a server in the
boat dashboard: `openbot-`, the plan, your account email with each other character as `-`, and the
first 8 characters of the server ID, such as `openbot-starter-ada-example-com-1a2b3c4d`. boat keeps
the name with the sandbox.

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

The mobile app keeps a support log of up to 1,000 events in the phone's system cache: app version,
system and device model, app state changes, connection steps with server IDs and error text, the
desktop app version and protocol support of each server, the method, address without query, status
and time of its requests, including Team API requests to the desktop, and app warnings and errors. It
does not record message text, files, request bodies or headers, and it masks tokens, keys and email
addresses. The app never sends the log. **Settings → Support** shows it and lets you save the file or
clear it.

Mobile chat, like desktop and web chat, shows the icon of the linked site beside a web link. To get
it, the phone requests `/favicon.ico` from the site of the link when it shows the message. The request
contains no conversation text. When the site has no icon, a local symbol shows. Mobile chat does not
fetch Markdown images when displaying a conversation.

Mobile chat can send selected files to the conversation's desktop host through the existing encrypted
team connection. Text pasted into the input is processed only after the user pastes it. A text paste
longer than 4,000 characters becomes a text attachment. Selected documents can also have a temporary
copy in the phone's system cache. Attachments added while editing a queued message are saved in the
phone's app document storage, with references in the saved edit, so they survive an app restart.
Those draft copies are removed when the attachment is removed or the edit is saved or cancelled.
A message that the phone has not delivered yet, for example while the server is offline, is saved
with its text, reply target and files in the phone's app document storage, separately per account,
so it survives an app restart. The phone sends it when the server is online again, and removes the
copy when the host confirms it, or when you edit or cancel it. Nothing else receives it. Sign-out
does not remove the copy: it is sent after you sign in to the same account again. A message to an
agent or server that you no longer have stays on the phone, because no chat shows it to cancel;
removing the app removes it.
Uploads are limited to 10 MB per file on mobile; successful uploads
become managed attachments on the host. Camera capture uses an in-chat preview. Photo selection uses the phone's system interface.
Image attachment previews are downloaded from the desktop host through the same encrypted connection.
Other attachments are downloaded when you choose Open or save. The phone creates a temporary file for
the system share sheet and removes it when that sheet closes. The app you select can keep its own copy.
Cloudflare account storage does not receive these files.
When you share text, a link, an image or a file from another app to OpenBot, the phone keeps a copy
of each file in its app cache until the chat that you choose has read it, or until you close the
share sheet. Nothing is sent until you send the message. On iPhone, the OpenBot share extension can
send the message itself, without the app. It uses the same encrypted connection to the host and the
same account service as the app. For this, the app gives the extension its session in a keychain
item that only the app and the extension can read, and writes the names of your servers and agents,
the agents' pictures and the servers' public keys to storage that only the app and its extensions share. These stay on
the phone, and sign-out removes them. The app tells iOS which agents you send messages to, so the
iOS share sheet can offer those agents first. iOS keeps this on the phone, and sign-out removes it. To find out whether a shared link points to
an image, the phone requests the link from its website and reads only the response headers. When the
link is an image, the phone downloads it and attaches it in place of the link. It stops a download
after 10 MB, and a larger image stays a link.

Mobile dictation and voice conversations listen only after you press the microphone. They use the
recognizer chosen under **Speech recognition** in **Settings → Voice**:

- Phone recognizer, the default. It is described below.
- Parakeet v3. When you press Download, the phone downloads the pinned Parakeet TDT 0.6B v3 model
  from `huggingface.co`, the same files as desktop, checks the SHA-256 of each file, and keeps it in
  the app's storage outside the device backup until you remove it. The request carries no user data.
  The audio and the recognized text stay on the phone.
- ElevenLabs Scribe, only with your own ElevenLabs API key. For each dictation, the phone asks
  `api.elevenlabs.io` for a single-use token with the key, then streams the microphone audio to
  ElevenLabs with that token, and receives the text. ElevenLabs handles the audio and the text under
  its own policy and your ElevenLabs plan. Nothing else is sent.

The phone recognizer asks for on-device recognition. On iOS, this applies when the phone supports it for your language. On
Android, it applies when the language model is installed. Otherwise, or when on-device recognition
fails before it recognizes any speech, the phone's recognition service, Apple or Google, receives the
audio. The recognized text goes into the message field and is sent
only when you send the message. OpenBot does not store or send the audio.

In a mobile voice conversation, the same recognizer hears what you say, and the recognized text is
sent to the agent as a message. The phone then reads the agent's reply aloud with the voice chosen in
**Settings → Voice**:

- Supertonic 3, the default. When you press Download, the phone downloads the pinned Supertonic 3
  model from `huggingface.co`, checks the SHA-256 of each file, and keeps it in the app's storage
  outside the device backup until you remove it. The request carries no user data. The reply text
  and its audio stay on the phone.
- ElevenLabs, only after you save your own ElevenLabs API key. The phone tests the key by listing
  your ElevenLabs voices and reading one character with the first voice, and then sends the text of each reply that it reads to `api.elevenlabs.io`
  with the key, and receives the audio. Nothing else is sent: no conversation history, file or agent
  instruction. ElevenLabs handles the text and the audio under its own policy and your ElevenLabs
  plan. The key is kept in the phone's keychain (iOS) or encrypted storage (Android), never in a log
  or an analytics event. Remove key in **Settings → Voice** deletes it.

The chosen voice settings are kept on the phone. OpenBot does not store the reply audio.

## Email delivery and infrastructure providers

OpenBot sends sign-in, team invitation, and welcome messages through the configured SMTP provider. The
provider receives the recipient address and the message content. A sign-in message contains the
one-time code and its expiration time. A team invitation can contain the inviter address, team name,
role, and invite URL. When the first cloud server plan of an account starts, a welcome message goes
to the account address. It contains the plan name and the server name. The HTML version of a message loads the OpenBot logo from `openbot.run` when
the mail client shows images. The image address is the same in every message and identifies no
recipient.

The contact form on `openbot.run/contact` sends your message to the OpenBot mailbox through the same
SMTP provider. The message contains the email address, topic and text that you enter, and the name and
company when you enter them. The account service stores none of these values. To limit how many
messages one address can send, it keeps a hash of your IP address in its rate-limit records. The OpenBot team receives the message
in its mailbox and uses your address only to answer you.

Cloudflare processes account and configuration API requests. It does not carry Team API, file,
message, command, Remote Desktop media, or Remote Desktop input traffic. It forwards sealed iPhone
Live Activity updates and phone notifications that it cannot read; see [iPhone Live Activity](#iphone-live-activity),
[iPhone notifications](#iphone-notifications) and [Android notifications](#android-notifications). For an
agent's Slack app, it exchanges the Slack sign-in and serves the install page; see
[Slack connections](#slack-connections). It does the same for the Discord app; see
[Discord connections](#discord-connections). For the OpenBot Telegram bot, it records which
computer answers each chat; see [Telegram connections](#telegram-connections). Cloudflare and the
email provider can keep their own security, delivery, and network logs under their own policies. These provider logs are outside the
OpenBot application database and its daily maintenance task.

The public status page at `status.openbot.run` is on GitHub Pages. GitHub serves it and keeps its
own request logs under its own policy. The page has no analytics and no cookies, and it loads
nothing from other sites. A GitHub Actions workflow checks the OpenBot services about every 5 minutes
with plain requests that carry no account or user data. Incidents on the page come from issues
with the `status` label in the public OpenBot repository. The same workflow sends the public incident
and service state to webhook addresses that the OpenBot team sets, such as a team chat channel. It
sends no account or user data.

Paid server plans use Stripe. You enter card and billing details on Stripe's pages, not in OpenBot.
Stripe sends the account service the subscription state, the plan, its price, the period, and the
account and server IDs that the subscription names, never the card number. When you choose a plan
for a new hosted server, the account service sends Stripe your account email and account ID (to
make the Stripe customer), and the server ID, the plan, the billing period and the currency (to
open Stripe Checkout, `checkout.stripe.com`). When you buy or change a license, it sends Stripe
your account ID, the number of users and the currency, and no names or emails of the users. When you delete a hosted server, the account service
tells Stripe to cancel its plan. When you manage billing,
the account service sends Stripe your Stripe customer ID, and the subscription ID of the plan you
change or cancel, to open the Stripe Customer Portal (`billing.stripe.com`). Stripe keeps the
customer, invoices and payment records under its own policy, also after the subscription ends.
Billing is off, and Stripe receives nothing, when the account service has no Stripe key.

## Data stored on the OpenBot computer

Saved agent memories, their inclusion settings, and their full-text search index stay in the local
SQLite database. Essential memories enter the agent's provider instructions within a fixed size
limit. Other saved memories reach the provider only when the agent retrieves them with a memory
tool. Search runs locally and does not use an external search or embedding service. Memory content
is not included in analytics; provider output uses the application's secret redaction. After every
20 turns of an agent's chat or side thread, after 15 minutes with no new turn, when the user clears
the chat, and when the user closes a side thread, OpenBot sends the agent's profile, its essential
memories, the saved memories that relate most to the conversation, and the new part of the
conversation, with secrets redacted, to the agent's own provider, on the agent's model or on the
provider's lower-priced default model, which proposes memory changes. Nothing else receives them.
Server settings > General > Memory review sets the number of turns (10, 20 or 40) for the agents of
the server, or turns these reviews off; off, no review sends anything. An owner or admin of a joined
server can change it.

- `~/OpenBot/Agents` contains one workspace per agent. A profile written by a release before the
  bot-to-agent rename holds them under `~/OpenBot/Bots`; the application moves them on first launch.
- `~/OpenBot/Shared` contains managed transfers shared between agents, and
  `~/OpenBot/Shared/Data/agent-data.db` holds the records the agents keep for themselves between tasks.
  Every agent on this computer can read and write every table in that file, and the user can delete any
  table in agent settings.
- `~/OpenBot/Downloads` contains files downloaded by the embedded browser.
- `~/Library/Application Support/OpenBot` contains the OpenBot SQLite database, agent metadata,
  conversations, message queues, direct messages, reactions, read state, attachment drafts and
  indexes, team configuration, local team members and sessions, the browser profiles and their
  cookies, application preferences, and the provider CLIs OpenBot downloads. The downloaded CLIs are kept in
  one store for the whole computer, which no other profile data shares.
- The local team configuration contains team member profiles, password hashes and salts when local
  password sign-in is used, invite and session token hashes, and the team identity key pair.
- `~/.codex` is owned by Codex CLI and contains its login and thread data. OpenBot does not copy or
  manage Codex credentials.
- `~/.claude` is owned by Claude CLI and contains its login and session data. OpenBot does not copy
  or manage Claude credentials.
- The MCP sign-ins are kept in `~/Library/Application Support/OpenBot`, encrypted by the operating
  system's secret storage in the same way as provider API keys. One record per server address holds
  the client registration and the access and refresh tokens. Removing the server in settings, or
  choosing Sign out on it, deletes its record. These values are redacted from logs, exports and diagnostics.
  The port and secret of the local MCP sign-in server are kept in
  `~/Library/Application Support/OpenBot/openbot-mcp-oauth-proxy-v1.json`, encrypted in the same way.
- The GitHub connection (Marketplace › Apps › GitHub) is kept in
  `~/Library/Application Support/OpenBot/openbot-github-connector-v1.json`, encrypted by the operating
  system's secret storage. It holds the GitHub access and refresh tokens, the account name, ID and
  avatar address, and the port and secret of the local GitHub MCP server.
  While the connection is on, `provider-state/github` in the same folder holds the access token and
  the OpenBot GitHub App's installation tokens in plain text, with mode 0600, for `gh` and `git` in
  agent tools. OpenBot deletes that folder when you disconnect and when the app closes; after a crash
  it stays until the next start. The tokens are redacted from logs, exports and diagnostics.
- The ElevenLabs API key for dictation is kept in
  `~/Library/Application Support/OpenBot/voice-api-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove key in **Settings → Voice**
  deletes the file. The key is redacted from logs, exports and diagnostics.
- The API key of the voice server is kept in
  `~/Library/Application Support/OpenBot/voice-server-key.json`, encrypted by the operating system's
  secret storage. The app window never receives the key back. Remove in the Voice server section of
  **Settings → Voice** deletes the file. The key is redacted from logs, exports and diagnostics.
- The Bitwarden connection keeps a CLI session key in process memory only. OpenBot does not
  save it to a file. Disconnect, eight hours without vault use, and app exit stop this connection.
  The log redactor can retain values in memory until exit to mask later messages.
  The Bitwarden CLI keeps its own encrypted vault cache. OpenBot reads login items in the folder
  `Shared with OpenBot`. Agents receive item ids, titles, and usernames; passwords and authenticator
  codes go through the main process to the browser page. This folder is an OpenBot access rule;
  the CLI session key can decrypt the wider vault. Use a separate Bitwarden account if you need
  the password manager itself to enforce that separation.
  An owner or admin of a joined server can connect that server's Bitwarden or Vaultwarden in
  Marketplace › Apps › Bitwarden with the server address, the personal API key and the master password. They
  go once, over the encrypted connection, to the server, which keeps them in
  `openbot-bitwarden-connector-v1.json` in its application data folder, encrypted by its operating
  system's secret storage, so it can unlock again after a restart. Its CLI keeps its own encrypted
  vault cache in `provider-state/bitwarden-host` in the same folder. The computer that sent them does
  not keep them, and no answer from the server carries them. Disconnect deletes the file and the
  cache. The API key and the master password can open the whole vault, not only the shared folder.
  They are redacted from logs, exports and diagnostics.
- The 1Password connection (Marketplace > 1Password) is kept in
  `~/Library/Application Support/OpenBot/openbot-onepassword-connector-v1.json`, encrypted by the
  operating system's secret storage. It holds the service account token and the account ID only.
  OpenBot keeps the list of logins (titles and web addresses) in memory, never on disk. A password
  or a one-time code is read from 1Password when the browser fills it, goes only to that page, and
  is never sent to an agent, a provider, a log or a team member. The token and each filled value
  are redacted from logs, exports and diagnostics. An owner or admin of a joined server can paste a
  service account token for that server in Marketplace › Apps › 1Password. The token goes once, over the
  encrypted connection, to the server, which keeps it in the same file on its own disk. The
  computer that sent it does not keep it, and no answer from the server carries it.
- The Vault (Server settings › Vault) is kept in
  `~/Library/Application Support/OpenBot/openbot-vault-v1.json`, encrypted by the operating system's
  secret storage. It holds the logins, payment cards (number, expiry, security code, name), contact
  info and API keys (variable name, key, notes) that the user saves. On a computer with no secret storage, such as Linux with no
  keyring, the Vault saves nothing. The file never leaves this computer. An owner or admin of a joined
  server can open that server's Vault in Server settings, from the desktop app or the web app: the
  list goes over the encrypted connection with no password, card number, security code or API key, and one of
  those goes to them only when they show or copy it. The iPhone app shows the same list and never
  asks for a password, a card number, a security code or an API key: a new one that the owner or admin types on
  the phone goes once to the server, and the phone does not keep it. Other team members cannot read it. An agent gets the login sites and usernames, the card names with their last
  four digits and expiry, and the contact info; it never gets a password, a card number, a security
  code or login notes. An agent can add and change contact info, change the username of a login (not
  its site) and the name, expiry and billing address of a card, and delete items, with no approval: the
  chat shows each change, and an item that an agent adds keeps the agent's name. Agents cannot see,
  add, change or delete a Vault API key as an item. When an agent lists its API keys, OpenBot writes
  each Vault key, readable only by the user, to
  `~/Library/Application Support/OpenBot/agent-api-keys/.vault/<NAME>`, outside every workspace, and
  gives the agent the path; every agent on the server can read these files in its commands. A changed
  key is written again, and a deleted key or a Vault that cannot be read removes its file, also at
  start. API keys are redacted from logs, exports and diagnostics. A password that the
  user types into the secure sign-in card goes to the Vault only while Save to Vault is checked. On a
  joined server, only an owner or admin can check it, the box starts unchecked, and the password goes
  to that server's Vault, not to the Vault of the computer where it was typed. The
  first card fill on a site waits for the server owner's approval; team members and messaging
  services cannot give it. The card then keeps that site and the origins of its card frames, and
  later fills there need no approval; the user can remove a site in the card. The
  browser types those values into the page, where the page's own scripts can read them, as they read
  what a person types. Until that page navigates, the agent cannot take a screenshot, evaluate
  script or record in that tab, and its snapshots hide the card fields. Passwords and card numbers
  are redacted from logs, exports and diagnostics, also in the desktop app of an admin who showed
  or copied one. A CSV import is read on this computer, from its own file dialog or from the text of
  a CSV export that an owner or admin picks in the iPhone app (`vault-import-v1`). That text goes once
  over the encrypted connection; the answer carries only the counts, and the phone deletes its copy
  of the file after it reads it.
- `~/Library/Application Support/OpenBot/logs/trace.ndjson` is a local trace of IPC calls,
  provider turns, main-process failures, and the steps of each connection to a joined server. Each
  line holds a time, the IPC channel name, the turn origin, the failure origin (`uncaughtException`
  or `unhandledRejection`) or the connection step (such as `remote-connect:ticket`), the duration,
  and the outcome word. A connection step does not name the server. The failure's error text goes only to the redacted log. The trace holds no payloads,
  messages, URLs, paths, or identifiers, and it goes through log redaction before it is written. It
  is kept to two files of 2 MB each and is never sent. It also records the exit of a renderer or
  helper process with its reason word, and the reason that OpenBot quit (such as
  `main_window_closed` or `quit`).
- `~/Library/Application Support/OpenBot/logs/main/main.log` holds the redacted lines of the main
  process: startup failures, uncaught errors, the reason that OpenBot quit, and why an update check,
  download or install failed. It is kept to two
  files of 1 MB each and is never sent.
- OpenBot keeps crash dumps of its own processes in the `Crashpad` folder of its user data
  (`%APPDATA%\OpenBot\Crashpad` on Windows). A dump holds part of the memory of the process that
  crashed, which can include conversation text, tokens or other secrets, and cannot be redacted.
  Dumps are never uploaded or added to a diagnostics export. Crashpad deletes old dumps by itself.
  Do not attach a dump to a public issue.
- `~/Library/Application Support/OpenBot/logs/resources.ndjson` holds one line a minute: the memory
  and CPU use of each OpenBot process group and provider id, the main process delay, the number of
  agent database statements, active turns and browser tabs. It holds no process IDs, program names,
  command lines or paths. It is kept to two files of 1 MB each and is never sent.
  `~/Library/Application Support/OpenBot/openbot-resource-summary-v1.json` holds the totals of
  today and of the previous day for the daily analytics summary and the diagnostics export.
- `~/Library/Application Support/OpenBot/openbot-push-notifications-v1.json` holds, for each member
  phone that gets notifications from this host, the session ID, the member ID, the Apple or Firebase
  push token, the secret that seals the notifications, the interface language, and the notification
  choices. Only the user can read the file, and it is not in the diagnostics export or the data
  export. See [iPhone notifications](#iphone-notifications) and
  [Android notifications](#android-notifications).

Attachments copied into OpenBot remain in managed storage after their original file is moved or
deleted. By default, all agents share one embedded browser profile, including cookies and website
sessions. An agent can instead use a profile of its own, or a named profile that only the agents
assigned to it share. Profile names stay in the local database of the computer that runs the agents.
On a joined server, an owner or admin reads the names, colors and agents of the host's profiles through
the encrypted host connection, and each member reads the name and color of the profile of a browser tab
that they can see. Cookies and site data of a profile do not leave the host. Clear data and Delete
remove the cookies and site data of a profile.
Websites receive the browser's Chromium user agent. HTTPS sites and local loopback HTTP sites also
receive basic client hints with the Chromium major version, operating-system name, and desktop flag.
Google account requests retain the Electron version token for sign-in compatibility.

## Remote Team API

When the owner publishes OpenBot, the app starts an authenticated Team API on a localhost port. The
client and host use a separate OpenBot Signal service to establish WebRTC. Signal carries only
short-lived authentication, SDP, and ICE messages. Team API data uses WebRTC DataChannels. Remote
Desktop media and input use a separate WebRTC connection. A paste in the Remote Desktop viewer
sends the member's clipboard text to the host, which puts it on the host's clipboard. The live browser view sends compressed
images of the host's browser tab, and the watching member's pointer and key input, over that same
media connection. ICE uses a direct peer-to-peer path when possible. If a direct path is not possible, encrypted WebRTC traffic uses an OpenBot coturn relay.
When the owner selects **Private network** in Settings › Mobile Connect, the host gets no STUN or
TURN server, so no WebRTC traffic goes through an OpenBot relay. Team API connections then use only
addresses on a private network, such as the Wi-Fi or a Tailscale tailnet. The desktop media
connection gets the same empty server list for each new stream, so it also uses only a direct path,
which can be a public IPv6 address of the computer. Sign-in and Signal messages do not change.

Agents, conversations, queues, direct messages, attachments, browser data, prompts, approvals, and
Remote Desktop data remain on the host. The central account service does not copy them into D1 or
R2. The Signal service does not proxy them or write them to logs. The host does not need a public
inbound port. The things Signal passes to a host are the Slack events of an agent's Slack app, the
Discord mentions of the Discord app, the updates of the OpenBot Telegram bot, and the requests to
webhook routines, in transit; see [Slack connections](#slack-connections),
[Discord connections](#discord-connections), [Telegram connections](#telegram-connections), and
[Webhook routines](#webhook-routines). For Discord and Telegram, Signal also carries the host's
answers to the platform.

An owner or admin of a joined server can manage its host from their own computer, or from the
browser client at `/app`. A provider API key, a custom endpoint key or header, the code that a
provider sign-in page shows, and a new server logo then travel from that computer or browser to the host over the same encrypted team connection. The
browser does not store a key. The host stores them as it stores a change made on the host.
No response returns a key, and neither computer writes request bodies to its logs. For a sign-in on
another device, the host sends the provider's sign-in link, and for Codex, Grok and Cline its
one-time code, to that computer or browser, which shows them and opens the link only when the admin
asks. The provider's CLI on the host receives the login; no token travels to the admin.

## Other network connections

Network traffic can also occur when:

- the local Codex App Server connects to OpenAI;
- the local Claude Agent SDK connects to Anthropic through Claude CLI;
- a user or an agent visits a page in the embedded browser;
- a user submits text that is not a web address in the browser address bar, which sends the query to Google Search;
- a locally installed Codex plugin connects to its service;
- an MCP server the user enabled is reached at its own address, and, when that server asks for a
  sign-in, OpenBot connects to the server's authorization service to register itself, to exchange
  the grant the browser returns, and to renew the token. When the user signs out of the server or
  removes it, OpenBot sends the tokens it deleted to that same service once, to revoke them.
  Agents reach a server that OpenBot signed in to through a local server on `127.0.0.1`, which adds
  the token to each call, so the token does not go to the agent's process.
  That local server tells the MCP server that the client is OpenBot: it sends
  `User-Agent: OpenBot/<version>` and, when a session starts, the client name `openbot`, the
  OpenBot version and the title `<agent name> (OpenBot)`, so the server can show which agent made a
  change. Nothing else about the user's agents, conversations or files is sent in those requests. The
  registration names OpenBot's logo at `openbot.run`; an authorization service that shows it on its
  sign-in page can make the browser load it from `openbot.run`;
- the user presses Install on the 1Password page. OpenBot downloads the 1Password CLI release that it
  pins from `cache.agilebits.com`, checks its SHA-256, and keeps it in
  `~/Library/Application Support/OpenBot/provider-state/1password-cli`. The request carries no user
  data;
- the user dictates or opens the Voice pane for the first time, or presses Download in **Settings →
  Voice**. OpenBot downloads the speech model that it pins, Parakeet, Underdog Bark 3.0 Plus or
  Whisper turbo, from `huggingface.co`, checks its size and SHA-256, and keeps it in `runtimes` in
  the application data folder. The request carries no user data. Dictation audio from these models
  stays on the computer, and the chosen model and language are saved in `voice-preference.json` in
  the same folder;
- the user selects ElevenLabs Scribe v2 Realtime in **Settings → Voice** and dictates or talks in
  the Voice pane. While the microphone records, or when a Voice pane turn ends, OpenBot streams the
  audio and the chosen language to `api.elevenlabs.io` with the user's own API key, and receives the
  text. Nothing else is sent: no conversation, file or agent instruction. ElevenLabs handles the
  audio and the text under its own policy and the user's ElevenLabs plan. The local models send
  nothing;
- the user sets up a voice server in **Settings → Voice**. OpenBot sends requests only to the address
  that the user enters, with the user's API key when there is one. To connect, it lists the server's
  models and voices. When the server does dictation, OpenBot sends the recorded audio, the chosen
  model and, when the user set one, the language to `/v1/audio/transcriptions` and receives the text. When the server reads
  replies aloud, OpenBot sends the text of each reply that it reads, the chosen model and the voice to
  `/v1/audio/speech` and receives the audio. Nothing else is sent: no conversation, file or agent
  instruction. The server handles the audio and the text under the policy of the person who runs it.
  The address and the choices are saved in `voice-server.json` in the application data folder;
- the user turns on Read replies aloud, opens the Voice pane for the first time, or presses Download
  in the Spoken replies section of **Settings → Voice**. OpenBot downloads the Supertonic 3 voice
  model that it pins from `huggingface.co`, checks its size and SHA-256, and keeps it in `runtimes`
  in the application data folder. The request carries no user data. The text of a reply that is read
  aloud, and its audio, stay on the computer. The setting and the chosen voice are saved in
  `speech-preference.json` in the same folder. In the Voice pane, the spoken reply runs on this
  computer, also for an agent on a remote server. Speech recognition uses the model chosen in
  **Settings → Voice**: a local model runs on this computer, and ElevenLabs gets the audio as
  described above. A message that the user speaks to an agent on this computer keeps its recording,
  a WebM/Opus file in the message's own transfer folder, so that the user can play it again in the
  chat. The agent, its provider and team members get only the text. A remote server gets only the
  text, as for a typed message, and no recording is kept. Recordings show in the Storage tab of
  **Server Settings**, where the user can delete them, and are part of a data export. A recording is
  deleted with the agent's or channel's data;
- the user connects Bitwarden. OpenBot runs the installed `bw` CLI to sync with the server already
  configured in that CLI, including a self-hosted server. It syncs before listing or filling logins.
  These calls send no OpenBot conversations, files, or agent instructions to Bitwarden. For a
  joined server's connection, the server's own `bw` signs in to the server address that the admin
  entered with the API key, and unlocks with the master password on that server. When that server has
  no `bw`, it downloads the Bitwarden CLI release that OpenBot pins from `github.com`, checks its
  SHA-256, and keeps it in `provider-state/bitwarden-cli` in its application data folder. That
  download carries no user data;
- the user connects 1Password. Connect runs the user's own 1Password CLI (`op`) on this computer to
  create the vault "Shared with OpenBot" and a service account that can read only it. OpenBot then
  reads that vault from 1Password's servers with the token: the vault names, the login titles and
  web addresses, and, when an agent signs in to a site, that login's username and password or code.
  Nothing about the user's agents, conversations or files is sent to 1Password;
- the user connects GitHub in Server settings. OpenBot asks `github.com` for a sign-in code and a
  token, renews the token, and reads the account name and the repositories of the OpenBot GitHub App
  from `api.github.com`. The GitHub page in Server settings loads the account picture from the
  address that GitHub gives, on GitHub's image host. Agents then reach the
  GitHub MCP server at `api.githubcopilot.com` and GitHub itself through `gh` and `git`, with that
  token. So that GitHub shows the OpenBot app as the author of an agent's work, OpenBot sends that
  token to the central account service (`api.openbot.run`) about once an hour, and when you open the
  repository list. The service uses it
  only to ask GitHub which repositories you can push to, and gets back short-lived installation
  tokens for those repositories. It does not store or log either token, and it gets no chats, files
  or commands. Agents reach the GitHub MCP server through a local server on `127.0.0.1`, which adds
  the right token to each call;
- an installed build checks GitHub Releases for updates;
- OpenBot checks for new provider CLI releases when it starts, once an hour, and when you select
  `Check for updates`. It asks `api.github.com` for Codex, `registry.npmjs.org` for Claude,
  OpenCode and Cline, `x.ai/cli` for Grok, and `raw.githubusercontent.com/agentclientprotocol/registry` and
  `dl.google.com` (for the download size) for Gemini, and the same registry and
  `downloads.cursor.com` (for the download size) for Cursor, and it reads a list of blocked
  versions from `raw.githubusercontent.com/nightly-labs/openbot`. These requests contain no account, agent,
  conversation or file data;
- an agent shows a visual reply, an agent checks its page with `html_preview`, or a user opens an
  HTML attachment, shared file or workspace file in the file preview. The page is HTML that the
  agent or the file wrote. It runs its scripts in a sandbox and can load scripts, styles, fonts
  and images from any address, such as a
  CDN. The server that holds those files gets the request and the network address of the computer,
  but no OpenBot cookies. The page cannot read the app, the conversation or other
  files. `html_preview` draws the page in a hidden window that has its own
  session in memory. The web client gets the page through the host connection and runs it in a
  sandboxed `srcdoc` frame with an opaque origin, so the page cannot read the web client's storage
  or its host keys; the browser sends no referrer for its requests. The mobile app runs the
  page in a web view, so the server gets the network address of the phone. On iPhone and iPad the
  web view keeps cookies and storage in memory only; on Android it has no page storage and no
  cookies for the files that the page loads. The page cannot call the app or read its files;
- a user opens an explicitly labeled external support or setup link;
- a Slack workspace is connected. See [Slack connections](#slack-connections);
- a Discord server is connected. See [Discord connections](#discord-connections);
- a Telegram chat is connected. See [Telegram connections](#telegram-connections).

## Webhook routines

An administrator can give a routine a webhook trigger. The routine then gets a public URL and a
signing secret. The host stores the trigger and the encrypted secret in its local SQLite database.
The signing secret is encrypted with the operating system's secret storage. It is shown one time.
Management screens do not return saved secrets.

Requests to a webhook routine pass through OpenBot's Signal service to the connected host. Signal
uses the sender's IP address in memory for rate limits. The account service keeps only the route
metadata above. Neither cloud service stores or logs request bodies. The host verifies the request
signature before it accepts the event. If the host is offline, the sender receives an error and
must retry. There is no cloud event queue.

The host keeps a receipt of each request for 7 days, to ignore a repeated delivery. A receipt has
the delivery ID, the event type, the result, and the run ID, but not the request body. The event is
added to the run instruction, which the host stores with the run. Event data can reach the
routine's model provider, as other routine input does.

Change a routine to a schedule, or delete it, to stop its URL. Deleting a routine deletes its
receipts.

## Workflows

A workflow is a graph of steps that the user draws on a canvas. The host stores each workflow, its
graph, up to 50 earlier versions of the graph, its runs, and the input and output text of each step
in its local SQLite database. A run also keeps a copy of the graph and, for a webhook run, the
request body. Runs stay until the workflow is deleted. Nothing about a workflow goes to the account
service, except the webhook route metadata above.

When analytics is on, product analytics gets the kind of each workflow action (for example create,
run, approve or restore), the kind of the step, the result, the duration and a coarse failure code,
and the outcome, duration and step counts of each run. It never gets a workflow name, step text,
graph, or ID.

- **Agent steps** send their input to the agent as a routine message. The agent's model provider
  gets it, as with other routine input.
- **Model and condition steps** send their input to the provider and model that the step names,
  without tools.
- **Outputs to a messaging place** post the workflow name and the text through that messaging
  connection.
- **Notifications** show the workflow name and at most 200 characters of text, with secrets
  removed, only when notification previews are on.
- **Webhook triggers** work like webhook routines: the same route metadata, Signal path, encrypted
  signing secret, and 7-day receipts without the request body. The host refuses a body of more than
  64,000 characters. The body, marked as data, is the trigger's output and goes to the next steps.
  Remove the trigger, or delete the workflow, to stop its URL.

Members of a joined server can read, change, and run a workflow when they can see and use each
agent in it (`workflows-v1`). The graph and the step text then go to their computer. Only owners
and administrators see a webhook URL or make a new signing secret.

Deleting an agent keeps the workflows and their step history without the agent. Deleting a
workflow deletes its versions, runs, steps, and receipts.

## Slack connections

A workspace member installs the OpenBot Slack app in their workspace from OpenBot on their computer.
The account service exchanges that install with Slack, because the app's secret lives there. It
records which OpenBot computer answers the workspace: the Slack workspace ID, the computer, the
OpenBot account that connected it, and the Slack app and bot user IDs. It keeps no Slack token and no
message. It gives the bot token to the computer encrypted to a key that only that computer has.

Slack sends the workspace's events, which contain the Slack messages in the channels OpenBot is in
and its direct messages, to OpenBot's Signal service (`signal.openbot.run`). Signal checks Slack's
signature and reads only the app ID and the workspace ID, to find the computer, and the type,
channel type, thread and bot ID of the event, to know whether it addresses OpenBot. It passes each
request to that computer over its Signal connection, in transit only: it does not store or log the
message. The answers go from the computer to the Slack Web API directly.

- **Stored on the host.** The bot token is encrypted by the operating system's secret storage, like
  provider API keys, and redacted from logs, exports and diagnostics. The database holds the
  workspace name and IDs, which agent is its Slack Orchestrator, and one row per Slack
  thread that an agent answers. The messages of that thread are kept as a conversation of that
  agent, with the Slack display name of each author, and files people send are kept with the agent's
  attachments. The database also holds the short facts about the workspace that its agents save
  (workspace memories); every conversation of that workspace shows them to the agent that answers.
  Disconnect revokes and removes the token and keeps the conversations and the workspace memories;
  deleting an agent removes its conversations and keeps the workspace memories.
- **Read from Slack.** The messages that mention OpenBot, the replies in a thread an agent answers,
  its direct messages, the files in them, the display names of their authors and of the people they
  mention, the names of the channels, earlier messages of a thread as context, and, when an agent
  asks for them, the newest messages of the channel or thread it answers in. OpenBot joins every public channel of the
  workspace, and Slack sends every message of each channel that OpenBot is in; the computer keeps
  only the messages that address OpenBot or continue a conversation.
- **Given to the Slack Orchestrator.** Every new Slack request goes first to the orchestrator agent,
  which runs on its provider like any other agent and passes the work to a teammate with the facts
  it needs.
- **Sent to Slack.** The agents' answers and the files they attach, short status posts ("Working on
  it…"), reactions, and approval requests with the command, folder and
  reason the provider gave, redacted. A failed request posts a fixed sentence, never the provider's
  error. Any agent, also in the user's own chat or a routine run, can post text, redacted, to a
  channel that OpenBot is a member of, and list those channels' names.

Anyone who can post in the Slack workspace, guests and Slack Connect members included, can give the
agents work. The agents run on the host with the access the user gave them. A hosted server that sleeps starts for a message that addresses OpenBot. Until it connects,
Signal keeps that message in memory for at most 10 minutes, encrypted to a key that only that server
has, so Signal cannot read it; a restart of Signal deletes it.

## Discord connections

A member of a Discord server with the **Manage Server** permission installs the OpenBot Discord app in
that server from OpenBot on their computer. The account service exchanges that install with Discord,
because the app's secret lives there, and revokes the Discord sign-in token that it gets at once. It
records which OpenBot computer answers the Discord server: the Discord server ID, the computer and the
OpenBot account that connected it. It keeps no Discord token and no message.

Discord has one bot token for every server, so only OpenBot's Signal service (`signal.openbot.run`)
holds it. Unlike Slack, both directions go through Signal:

- **To the computer.** Signal keeps the bot's connection to Discord. Discord sends it the messages of
  the channels OpenBot can view. When OpenBot's Signal has the Message Content intent, they include
  the text of every message; otherwise only the messages that mention OpenBot have text. Signal
  passes on only the messages that mention OpenBot and the presses of OpenBot's buttons: the message
  text, the author's ID, name and role IDs in the server, the channel, the addresses of its files, and
  the message it replies to when a person wrote it (with its author, time, and the text and file
  addresses that Discord gave). The computer downloads the files from Discord directly.
- **From the computer.** The computer sends its posts, edits, reactions, files and name lookups to
  Signal, which makes each call to Discord for it, only in the Discord servers linked to that
  computer. To give context, the computer asks Signal for the earlier messages of a channel after the
  first message of a conversation, for the messages of the 15 minutes before a new conversation,
  and, when an agent asks for them, for the newest messages of the channel it answers in. These
  earlier messages have the addresses of their files, and the computer downloads those files from
  Discord directly. With the Message Content intent, these earlier messages have their text and files
  also when they do not mention OpenBot. It also asks for the names of the people that a message
  mentions, and, when the user chooses who can use OpenBot, for the names of the server's roles.

Signal does not store or log a message, a file or a token; it keeps the server and channel names and
IDs in memory to check each call. It answers a direct message to OpenBot with one fixed sentence and
passes nothing on.

- **Stored on the host.** The Discord server's name and ID, which agent is its Discord Orchestrator,
  the IDs and names of the roles allowed to use OpenBot in it, and one row per conversation that an agent answers, kept as a conversation of that agent with the
  Discord display name of each author. Files people send are kept with the agent's attachments.
  Workspace memories are kept as for Slack. Disconnect removes the link and keeps the conversations,
  the workspace memories and the allowed roles; deleting an agent removes its conversations. The
  author's role IDs are checked and not stored.
- **Given to the Discord Orchestrator.** As for Slack.
- **Sent to Discord.** As for Slack: the answers, attached files of at most 10 MB, status posts,
  reactions, and redacted approval requests. A post never pings anyone. As for Slack, any agent can
  post redacted text to a channel or thread of the server, and list their names through Signal.

Anyone who can post in a channel that OpenBot can view can give the agents work, unless the user
chose roles: then only members with one of those roles can, and OpenBot ignores the others. The agents run on the
host with the access the user gave them. A hosted server that sleeps starts for a message that addresses OpenBot. Until it connects,
Signal keeps that message in memory for at most 10 minutes, encrypted to a key that only that server
has, so Signal cannot read it; a restart of Signal deletes it.

## Telegram connections

One OpenBot Telegram bot serves every user. Its token is only in OpenBot's Signal service
(`signal.openbot.run`); no computer has it. The user connects a chat from OpenBot on their computer:
the account service gives a one-use code, and the browser opens a `t.me` link with it. When the user
adds the bot to a group, or starts a direct chat with it, Telegram sends the code in that chat.
Signal then asks the account service to link the chat to the computer. The account service records
the Telegram chat ID, the bot ID, the computer, the OpenBot account and the time of the link, and a
hash of each code until it is used or expires. It keeps no chat name and no message.

Telegram sends each update of a linked chat, which contains every message of a group or a direct chat
and button presses, to Signal. Signal checks Telegram's secret
header and reads only the chat ID, a link code and the ID of a button press, to find the computer, and
the chat type, the entity types and whether a message replies or is in a thread, to know whether it
can address OpenBot. It
passes each update to that computer over its Signal connection, in transit only: it does not store or
log it. The computer's answers, status posts, reactions and files go to Telegram through Signal,
because only Signal has the token. Signal accepts only a fixed list of Bot API calls, only for the
chats linked to that computer, and returns only message IDs to it. Files go through Signal with
short-lived signed addresses, in transit only.

- **Stored on the host.** The bot ID, the bot username, the chat ID and the chat name are encrypted
  by the operating system's secret storage and redacted from logs, exports and diagnostics. The
  database holds the chat name and IDs, which agent is the Telegram Orchestrator, and one row per
  conversation that an agent answers. The messages of that conversation are kept as a conversation
  of that agent, with the Telegram name of each author, and files people send are kept with the
  agent's attachments. The names of authors and the last messages of a chat are also kept in memory
  for context, until OpenBot quits. Workspace memories are kept for each chat, as for Slack.
  Disconnect makes the bot leave the chat, unlinks it and keeps the conversations and the workspace
  memories; deleting an agent removes its conversations.
- **Read from Telegram.** Every message of a linked chat, the files in them, the names of their
  authors and the name of the chat. The OpenBot bot has privacy mode off, because with it on,
  Telegram does not send a plain mention to a bot that is not a group admin. A request starts only
  from a message that mentions the bot, a reply to it, another message of a reply chain that an
  agent answers, or a message of a direct chat. The other messages of a group stay in the
  computer's memory until OpenBot quits, and an agent can read the last of them with its history
  tool, as for Slack.
- **Given to the Telegram Orchestrator.** Every new Telegram request goes first to the orchestrator
  agent, which runs on its provider like any other agent and passes the work to a teammate with the
  facts it needs.
- **Sent to Telegram.** The agents' answers and the files they attach, short status posts ("Working on
  it…"), reactions, and approval requests with the command, folder and reason the provider gave,
  redacted. A failed request posts a fixed sentence, never the provider's error. As for Slack, any
  agent can post redacted text to a linked chat.

Anyone who can post in a linked chat can give the agents work. The agents run on the host with the
access the user gave them. A hosted server that sleeps starts for a message that addresses OpenBot. Until it connects,
Signal keeps that message in memory for at most 10 minutes, encrypted to a key that only that server
has, so Signal cannot read it; a restart of Signal deletes it.

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

Full access also permits that agent to publish, update and delete public hosted sites without
another confirmation. Publishing makes the selected site content publicly accessible. At Workspace
only or Ask first, hosted-site changes require confirmation. Site ownership and source validation still apply.

## Exports

The account menu can export a local ZIP containing agent profiles, conversation snapshots, queues,
and managed message attachments. It intentionally excludes CLI credentials, browser cookies, and
agent workspace files.

The diagnostics export contains application and CLI versions, capability states, aggregate queue
counts, a summary of the local trace: counts, outcomes, and durations for each IPC channel,
turn origin, and failure origin, and the resource summary: the last sample and the memory, CPU,
responsiveness, database statement and crash figures of today and the previous day. It contains no conversations, visited URLs, account email, file
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

When you change an agent's provider, the new provider receives the chat history with its first
message. That history includes the work steps that the previous provider recorded: commands, the end
of their output, changed file paths, tool names, searches and progress notes. OpenBot removes known
secrets from these steps first. Command output can contain file contents. Reasoning, diffs and
attachment contents are not sent.

Publishing an agent template from the chat makes its instructions, skills, and routines public to
anyone with the link at `openbot.run/agents/<id>`, with your account name as the creator. OpenBot
stops the publish when a text field looks like a secret. Workspace files and memories are not sent.
An owner or admin of a server can also publish, update or unpublish an agent of that server from the
browser client. The host sends the template content and the agent's avatar to that browser for the
preview, and publishes with the account signed in on the host, so that account is the creator.

Marketplace submissions from the desktop app show the publisher’s current account photo publicly on the listing. Account photo updates appear on the listing; removing the account photo removes it from the listing. Private memories and integration credentials are not included.

### OpenCode

OpenBot downloads the OpenCode CLI (the `@opencode/cli` packages) and its license (from the
`opencode-ai` package) from `registry.npmjs.org`, then starts it with `opencode acp`. Prompts, attachments, and tool
results go to that local process. OpenCode can send them to the model provider selected in its
configuration. OpenCode's free models are the default, and they reach OpenCode Go with no account,
so a first OpenCode turn leaves this computer without a sign-in.

An OpenCode Go key is optional and unlocks the paid catalog. OpenBot encrypts it with the operating
system's secret storage, writes it to a file that only your user account can read, and passes it
to the local OpenCode process. To show the remaining Go quota in Usage, OpenBot also sends the key
to `opencode.ai/zen/go/v1/usage`; that request contains no conversation, file, or model data, and
the response contains only the used percentage and reset time of each Go limit. OpenBot does not
send that usage to its maintainer. No screen, log, data export, or diagnostics report contains the
key; the data export lists it under `scope.excludes`.

When you saved no key in OpenBot, OpenBot reads the Go quota with the key that the OpenCode CLI
uses: an OpenCode Console connection in OpenCode's database (`opencode.db`), else the Go key. The Go
key is the `opencode-go` key in OpenCode's `auth.json` (or `OPENCODE_AUTH_CONTENT`), or
`OPENCODE_API_KEY` from the environment that started OpenBot when `auth.json` has none. OpenBot reads
these from OpenCode's data folder (`$XDG_DATA_HOME/opencode`, or `~/.local/share/opencode`) and sends
the key only to `opencode.ai/zen/go/v1/usage`. When OpenCode rejects the Console key, OpenBot tries
the Go key. OpenBot does not store, log, or show these keys. OpenBot does not copy OpenCode credentials or upload its session
files. OpenCode manages its own login and resume state.

### Gemini

OpenBot downloads Google's Antigravity ACP server from `dl.google.com` when you select Download on
the Gemini row. Each provider update check also asks `dl.google.com` for the size of the newest
download, also when you do not use Gemini. Google's license does not let OpenBot include it in the application. OpenBot
starts the server as a local process. Prompts, attachments, and tool results go to that process,
and the server sends them to Google. Connect opens Google's sign-in page in your browser. On this
computer, Sign in saves a Gemini API key instead: OpenBot encrypts it in its existing provider
credential store, gives it to the server as `GEMINI_API_KEY`, and redacts it from logs. The server
sends the key to Google. The server keeps its login and session files in `~/.gemini`, or in `$GEMINI_HOME`. Each Gemini
account that you add after the first keeps them in a folder of its own in OpenBot's data folder, and gets no saved API key;
Remove deletes that folder. OpenBot does not read, copy, or upload these files. Google's terms apply: <https://antigravity.google/terms>.
Gemini agents stay on this computer: OpenBot does not show them to team members.

To show the remaining Gemini quota in Usage, OpenBot sends the server's `/usage` command in a
session that no agent uses. The server asks Google for the quota of the signed-in account; the
command contains no conversation, file, or model data. The server keeps that session with its other
session files in `~/.gemini`. OpenBot does not send that usage to its maintainer.

### Cursor

OpenBot downloads the Cursor CLI from `downloads.cursor.com` when you select Download on the Cursor
row. Each provider update check also asks `downloads.cursor.com` for the size of the newest
download, also when you do not use Cursor. OpenBot starts the CLI as a local process. Prompts,
attachments, and tool results go to that process, and the CLI sends them to Cursor. Sign in opens
Cursor's sign-in page in your browser, or the CLI uses `CURSOR_API_KEY` from the environment that
started OpenBot. OpenBot gives that key only to the local CLI, in its environment, and does
not store it. The CLI keeps its login and session files
in `~/.cursor` (on Linux, the login is in `~/.config/cursor`). On macOS the CLI keeps its login in
the login Keychain. OpenBot does not copy or upload these files. Cursor's terms apply:
<https://cursor.com/terms-of-service>. Team members see the host's Cursor agents, as for the other
providers, when their app supports Cursor.

To show the remaining Cursor plan usage in Usage, OpenBot reads the CLI's access token: on macOS
from the Keychain item `cursor-access-token`, else from the CLI's `auth.json`. OpenBot sends the
token only to Cursor (`api2.cursor.sh`, or `CURSOR_API_ENDPOINT` when you set it for the CLI), in
the same usage request that the CLI sends. The request contains no conversation, file, or model
data. OpenBot does not store, log, or send the token or the usage to its maintainer.

### Cline

OpenBot downloads the Cline CLI from `registry.npmjs.org`, and its license file from `github.com`,
when you select Download on the Cline row. OpenBot starts the CLI as a local process. Prompts,
attachments, and tool results go to that process, and the CLI sends them to Cline and to the model
provider you select in Cline. The provider of a free model can use your prompts to train models.
Sign in opens Cline's sign-in page in your browser, or the CLI uses `CLINE_API_KEY` from the
environment that started OpenBot. OpenBot gives that key only to the local CLI, in its environment,
and does not store it. The CLI keeps its login and session files in `~/.cline`, or in `$CLINE_DIR`.
OpenBot does not read, copy, or upload these files. When OpenBot reads the Cline model list, it
also sends `GET https://api.cline.bot/api/v1/ai/cline/recommended-models` to read Cline's free
models, which the CLI does not list. The request has no account, key, or prompt in it, and Cline
sees the IP address of this computer. Cline's terms apply:
<https://cline.bot/tos>. Team members see the host's Cline agents, as
for the other providers, when their app supports Cline.

### Inception

Inception agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Sign in on the
Inception row saves an Inception API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with the key to `api.inceptionlabs.ai`. When OpenBot reads the Mercury model list, Pi does not
contact Inception. Pi keeps its session files in its own folder, as for Pi agents. OpenBot does not
copy or upload these files. Inception's terms apply: <https://www.inceptionlabs.ai/docs/terms-of-use>.
Inception agents stay on this computer: OpenBot does not show them to team members.

### DeepSeek

DeepSeek agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Connect on the
DeepSeek row saves a DeepSeek API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with this key to `api.deepseek.com`, also when Pi has its own DeepSeek key. When OpenBot reads
the DeepSeek model list, Pi reads its built-in list and does not contact DeepSeek. Pi keeps its
session files in its own folder, as for Pi agents. OpenBot does not copy or upload these files.
DeepSeek's terms apply:
<https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html>.
DeepSeek agents stay on this computer: OpenBot does not show them to team members.

### OpenRouter

OpenRouter agents run in the Pi CLI that OpenBot downloads for Pi. On this computer, Connect on the
OpenRouter row saves an OpenRouter API key. OpenBot encrypts it in its existing provider credential
store, gives it to the local Pi process in its environment, and redacts it from logs. Pi does not
write the key to a file. Prompts, attachments, and tool results go to that process, and Pi sends
them with this key to `openrouter.ai`, also when Pi has its own OpenRouter key. OpenRouter sends the
request to the company that serves the selected model, and that company's terms also apply. When
OpenBot reads the OpenRouter model list, Pi reads its built-in list and does not contact OpenRouter.
Pi keeps its session files in its own folder, as for Pi agents. OpenBot does not copy or upload these
files. OpenRouter's terms apply: <https://openrouter.ai/terms>. OpenRouter agents stay on this
computer: OpenBot does not show them to team members.

### Local model servers

When Server settings shows the Providers section of this computer, and once on the onboarding
provider step, OpenBot looks
for model servers on this computer. It sends `GET <address>/models` to
`http://127.0.0.1:11434/v1` (Ollama), `http://127.0.0.1:1234/v1` (LM Studio), and each address you
add under Local detection. These requests
contain no key, header, conversation or file data, and OpenBot does not follow a redirect. A found
server is only listed; OpenBot saves nothing until you select Add.

When you add or edit an endpoint, Load models sends the key and headers you typed to that address.
For a saved endpoint, OpenBot sends the stored key and headers only to the same origin as the saved
address. Local detection can be turned off in Settings. Its switch, addresses, folders and hidden
rows are in `openbot-provider-detection-v1.json` in the app profile.

### Custom agents

A custom agent is an ACP program that you name. OpenBot starts it as a local process, and prompts, attachments, and tool results go to that process. What the program sends
to the network is its own choice. Check agent starts it once in an empty temporary folder, sends
`initialize`, opens one session with no MCP servers to read the agent's models, and stops it.
To find agents, OpenBot looks up the names of known agents on your `PATH` and in the folders you
add under Local detection. It does not start a file that it finds.

The command, arguments, and environment names are in `custom-agents.json` in the app profile. The
environment values are encrypted with the operating system's secret storage, go only to that
process, and are not in a screen, log, data export, or diagnostics report; the data export lists
them under `scope.excludes`. Custom agents stay on this computer: OpenBot does not show them to
team members.

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

## iPhone Live Activity

The iPhone app can show the state of the agents on the Lock Screen and in the Dynamic Island. While
the app runs, the phone makes this view itself from the data that it receives over the encrypted
host connection.

When iOS stops the app in the background, the active host updates the view through Apple Push
Notification service (APNs). For this, the phone gives that host, over the encrypted host
connection, the push token of the Live Activity, a 32-byte secret for that host, its interface
language, and the file names of the agent pictures that it saved on the phone. The phone makes each
host secret from one random phone secret, so one host cannot seal an update or sign a button for
another host. The phone keeps its secret in its secure storage and makes a new one when the user
signs out. The host keeps these values in
memory only, for the session that gave them. It forgets them when the phone removes them, when the
session ends, when the member is removed or disabled, when Apple refuses the token, after 12 hours,
and when the host stops.

Each update contains the text that the view shows: agent names, the current task, the last reply,
a question and its options, or a command that waits for approval. The host seals the update with
keys made from the secret (an HMAC-SHA256 keystream and an HMAC-SHA256 tag) and sends it to the
OpenBot account service, which sends it to Apple. The account service and Apple receive only the
push token, the sealed bytes, the time, the priority, the time when the content becomes out of
date, and, for an update that shows an event that would notify the member, the sound name. They
cannot read the content. The widget on the phone opens it and shows nothing with a
wrong tag. The account service stores nothing from these requests and does not log them. It makes
the Apple request itself. An update with a sound lights up the screen and has "OpenBot" as its
only text, so a host cannot use it to send an ordinary notification. Apple can keep its own delivery logs under its own policy.

The buttons in the view open the app. A button that changes host state, such as Approve or an
answer, has a signature made with a key that only the phone and the host have, so another app
cannot start the action with an `openbot://` link. The app shows the command again before it
approves it.

Settings > Notifications > Live Activities turns this off. The phone then removes its token from the
host.

## iPhone notifications

The iPhone app can show a notification when an agent finishes a task, stops with an error, or needs
an answer, an approval, or a step in the browser, while the app is not on screen. The host does not
send one while the member uses a desktop app. For this, it keeps in memory the time of the last
send, answer or typing of each session, and on its own computer it reads whether the OpenBot window
has focus and how long the computer has had no input. While the phone shows the Live Activity of
that host, the host sends no notification. With Play sound on, the Live Activity update lights up
the screen and plays the sound instead. For this, the phone gives each connected host, over the
encrypted host connection, the Apple push token of the app (none when notifications are off and only
the Live Activity plays the sound), the 32-byte secret for
that host (the one of the Live Activity), its interface language, and the choices of the user: the
events of that server, a mute end, whether the notification shows a preview, and the sound, or none,
and when its Live Activity of that host started. The host
keeps these values in a file that only the user of that computer can read, so it can notify the phone
after a restart. It removes them when the phone removes them, when the member is removed or
disabled, and when the account service or Apple refuses the phone.

Each notification contains the agent name and a short text. With previews on, the text is the start
of the agent reply, the question, or the command or reason of an approval, at most 200 characters,
with secrets hidden as in desktop notifications. With previews off, it only says what
happened, such as "Finished working.". The host seals the notification with keys made from the
secret, as it seals a Live Activity update, and sends it to the OpenBot account service with the
account session of the phone. The account service sends nothing when that session has ended, when
the device signed out, or when the membership was removed. Otherwise it sends the notification to
Apple with "OpenBot" as its only text. The account service receives only the push token, the session
ID, the sealed bytes, the sound name, and the time. Apple receives the same values without the
session ID. They cannot read the agent name or the text. The account service stores nothing from these requests and does not log them. Apple can
keep its own delivery logs under its own policy.

On the phone, the notification extension of the app opens the notification with keys that the app
keeps in its App Group, and iOS shows the agent name and the text. A notification that the extension
cannot open shows the app name only, so the account service, Apple, or a host that does not have the
keys of the phone cannot make it show text. A host that has the keys can show text only in the name
of its own server. Signing out removes the keys from the phone, asks each connected host to remove
the registration, and makes a new phone secret. A host that does not get the request sends nothing
more, because the account service refuses the ended session.

Notifications only inform: they have no buttons, also on a paired Apple Watch. The app keeps its
sign-in, the keys of the hosts and the server list choices in the iOS keychain with access after the
first unlock since the phone started, on this device only.

Settings > Notifications turns this off, and sets the preview and the sound. The events and the mute
of each server are in the same place and in the server settings.

## Android notifications

The Android app shows a notification for the same events, and in the same conditions, as the iPhone
app. Android has no Live Activity. For this, the phone gives each connected host, over the encrypted
host connection, the Firebase Cloud Messaging push token of the app, the 32-byte secret for that
host, its interface language, and the choices of the user: the events of that server, a mute end,
whether the notification shows a preview, and the sound, or none. To get the token, the Firebase
library in the app connects to Google. The app has no Firebase analytics. The host keeps and removes
these values as it does for an iPhone, in the same file, and removes them also when Google refuses
the phone.

The host seals each notification as it seals an iPhone notification, and sends it to the OpenBot
account service with the account session of the phone. The account service checks the session as it
does for an iPhone. Then it sends Google a data message that has only the sealed bytes and the sound
name. The account service receives only the push token, the session ID, the sealed bytes, the sound
name, and the time. Google receives the push token, the sealed bytes, and the sound name. They cannot
read the agent name or the text. The account service stores nothing from these requests and does not
log them. To send, it uses a Firebase service account key, which it keeps as an encrypted secret.
Google can keep its own delivery logs under its own policy.

On the phone, the app opens the notification with keys that it keeps in its private files folder,
and Android shows the agent name and the text. A notification that the app cannot open shows the app
name only. Signing out removes the keys from the phone and makes a new phone secret, as on an iPhone.
Notifications only inform: they have no buttons.

Settings > Notifications turns this off, and sets the preview and the sound. Android also lists one
notification channel for each sound in the system settings of the app.

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
shown HTTPS site for one submission. Connected desktop, mobile and browser clients send the value through
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

## Error and warning reports

Production desktop, browser app, and mobile clients report safe failure categories to the same
self-hosted OpenPanel service. Reports can include the app version, platform, provider, model,
operation, severity, and a fixed cause code. They also record whether a problem appeared as a
toast, shared alert or chat banner, or native error/warning alert. These reports do not include displayed text,
raw exceptions, stack traces, prompts, messages, file names, paths, commands, or credentials.
A random report ID helps identify repeated delivery attempts; it is not a conversation or file ID.
A reported cause describes the error observed by OpenBot and might not explain its root cause.

Validated reports wait in local files on the host and mobile, or IndexedDB in desktop and browser
clients. Each queue is limited to 1,000 reports, 1 MiB, and seven days. Reports are removed after
OpenPanel accepts them, when they expire, or when the queue reaches its limits. Network failures
can cause retries and duplicate delivery. Queue failures do not block the application.

Turning off analytics or changing accounts clears pending reports and cancels active sends.
Requests already received by OpenPanel cannot be recalled. Anonymous error reports remain
anonymous. The browser app has its own local analytics setting in account settings, separate
from desktop and mobile. Collection is enabled by default; a malformed or unreadable setting
keeps it disabled. Existing OpenPanel retention rules apply after delivery.

### Remote host release checks

When a server administrator checks an OpenBot release, the host requests the public stable
release manifest from GitHub for its operating system and architecture. The request includes no
account data, chats, files, commands, or credentials. GitHub receives the host IP address as part
of the connection. Connected administrators receive the installed version, release version,
check status, and installation method.


## Pi, Muse, and ACP registry setup

Pi and Muse run on the host selected for the agent. They receive the conversation input, attached
images, tool definitions, and enabled MCP server configuration needed for a turn. Provider account
files remain under each provider's control. An explicit Meta API key is encrypted in OpenBot's
existing provider credential store. Log in with code for Muse starts a local Muse process, with no
shell, no file writes and no Meta API key, that asks Meta for a code. You confirm the code on Meta's
page, and Muse keeps the account in its own files. Settings responses and settings-change events contain no
provider credentials; the event carries only the agent ID.

ACP registry search fetches the catalog from `cdn.agentclientprotocol.com`; search text is matched
on the host. Installation downloads the selected distribution from its published source. Pi update
checks use `api.github.com`. Muse update checks use `api.meta.ai`, and manifests and binaries come
from `lookaside.facebook.com`. Download requests reveal the host IP address and requested artifact.
Registry install records remain on the host, separate from conversations and credentials.

An authorized remote administrator can install, update, cancel, or remove a registry runtime on
the host through the encrypted Team connection. Removal does not delete agent configuration,
credentials, or conversations. The existing cloud service does not store those files.
