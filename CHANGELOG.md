# Changelog

All notable changes to OpenBot will be documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.18.0] - 2026-09-23

### Added

- Use OpenBot in French.
- Open invitation (including permanent links), pairing, and plugin links directly in the mobile app.
- See a running, waiting, blocked, or failed routine as a mark on the agent row.
- Update a provider, or sign in with a code, from the new "More actions" menu on each provider row.
- Start with OpenCode free models without a sign-in.

### Changed

- New ChatGPT agents start on GPT-6 Luna, and new Claude agents on Claude Opus 5.5. Existing
  agents keep their model.
- Refresh the server list on other signed-in devices when a membership changes.
- Show the routine run history in chat as one summary per run.
- Improve mobile reply animations and keyboard scrolling.

### Fixed

- Send live view clicks to the correct point of the remote page.
- Keep Claude narration between tool calls out of the chat bubble.
- Keep embedded browser sign-in popups and OAuth sessions working.
- Load a remote server's agents when one agent uses a 1M-context Claude model.
- Show why an updated OpenCode CLI stopped, instead of "ACP connection closed".
- Stop showing a Grok tool error as a provider error.

## [0.17.0] - 2026-09-21

### Added

- Use Computer Use with Codex, Claude, Grok, and OpenCode. OpenBot now includes the
  Computer Use driver on macOS, Windows, and Linux.
- Set up remote desktop access from Server Settings. Check Sunshine permissions,
  display availability, and the macOS user session; open a helper to grant access.
- Test remote desktop video, mouse, and keyboard with a temporary test panel, including
  a local test on the same Mac. Older runtimes support a video-only test.
- Enter passwords and authentication codes through secure browser prompts in chat.
  Secret values stay out of agent messages and browser captures during submission.

### Changed

- **On macOS, grant Screen Recording and Accessibility to OpenBot for Computer Use.
  Grants for the old Codex helper do not carry over. Remote desktop uses separate
  Sunshine grants in the macOS account that runs it.**
- Enable ordinary auto-approval by default for new agents. Existing saved agent choices
  are preserved. Automatic website publishing, replacement, and deletion require Turbo.
- Keep previous approval settings in their original file during upgrade.
- Rename a saved MCP server named `computer_use` to an available `computer_use_saved`
  name. Its configuration and credentials are preserved.
- Explain when updates are managed by the host in Settings.

### Fixed

- Backport Sunshine security fixes for malformed input packets, pairing approval, and
  exact client certificate checks.

- Keep provider downloads available while provider checks run.
- Support Canva and other MCP sign-ins that require a local redirect address.
- Allow plugin removal from its marketplace page.
- Keep local remote desktop tests independent of account ICE settings, reject malformed
  viewer URLs, and avoid repeated Sunshine restarts while granting permissions.

### Removed

- Remove the separate Codex Computer Use plugin setup and the Agent CLI setup card.

## [0.16.0] - 2026-09-21

### Added

- Sign in to ChatGPT with a code typed on another device. OpenBot shows the code, opens the
  verification page, and reports when the sign-in finishes.
- Set standing approval for one agent or enable Turbo mode for all local agents. Turbo keeps each
  agent's individual approval when it is turned off.

## [0.15.3] - 2026-09-21

### Added

- Start an MCP server on a computer that has no Node. OpenBot downloads Bun 1.4.2, a JavaScript
  runtime it owns and checks, and starts a STDIO server with it. A computer with its own Node keeps
  using that one: the managed runtime is the floor, not a replacement.
- Say why an MCP server did not reach an agent. A command this computer does not have, and a
  working directory the provider cannot carry, each raise one notice naming the server and the
  reason, and the panel states the working-directory limit before the server is saved.
- Answer a question an MCP server asks, on every provider. A server that needs a field gets one
  question for each field it requests, with the typed value it asked for, a secret hidden as it is
  entered, and a decline that names the field the server cannot do without.
- Invite people with a permanent link, in the new **Perma link** tab of server settings. The link
  is reusable and never expires, so it suits a channel or a document rather than one person. A host
  keeps at most five, each one is revoked from the same tab, and a permanent link cannot be bound
  to an email address. Single-use invitations are unchanged. A server that speaks an older Team API
  does not offer the tab, because that protocol carries no permanent link.
- Update OpenBot for every account on a shared Mac from one place, with the new Host package.
  An administrator installs it, and the Mac then downloads a release once, waits until every
  signed-in account is idle, installs it one time, and starts OpenBot again for each account. A
  managed account shows the host's progress and never installs on its own. The package is signed
  and notarized on its own, and it installs managed-host infrastructure only: the DMG is still the
  application. The installer also creates Standard accounts for tenants.

### Changed

- **A server declared outside OpenBot no longer reaches a Claude or Codex agent. Add it in
  Settings, MCP to keep it.** This covers `~/.claude/settings.json`, a project `.mcp.json`, a
  plugin, agent frontmatter and `~/.codex/config.toml`. Nothing is deleted: the declaration stays
  in its own file and OpenBot does not read it. A notice says this once. OpenCode and Grok document
  no equivalent setting, so their agents can still start servers from their own files, which the
  panel now states.
- **Sign in again once after upgrading to reach Canva, Figma, Linear, Notion, Sentry or Stripe.**
  The six listings now connect over HTTP and OpenBot holds the OAuth client itself: it opens the
  browser, keeps the tokens in the operating system's secret storage, and adds the header when it
  hands the server to a provider. No third-party bridge program is downloaded or started. A bridge
  that already holds a token keeps it in its own folder, which OpenBot does not read, so the sign-in
  does not carry over. Removing the server forgets its sign-in, and the tokens are redacted on every
  log and export path like every other secret.
- Replace a Codex thread that started before this release once, keeping its conversation and its
  history, so the tools the agent has match the panel.
- Re-read a provider's remaining usage while the figure is on screen, so a window that counts down
  no longer reads minutes out of date. The dock, the account menu and the usage popover refresh a
  reading that is five minutes old. Nothing is read while no view shows the figure, and a hidden
  window reads again when it comes back.
- Run two Remote Desktop sessions at the same time on a shared Mac. Each signed-in account gets its
  own port range, so one session no longer takes the ports the other needs.

## [0.14.1] - 2026-09-19

### Changed

- Sign in to Claude from the composer notice, which opens the OAuth window instead of the
  authentication documentation. OpenCode, whose key is pasted in settings, no longer raises a
  notice with a button that starts nothing.
- Name the provider under each mark in the header model picker rail, with its state below the name.

### Fixed

- Ship the 0.14.0 work, which no build carried: that release stopped while it was being packaged,
  on a test that allowed one second for the interface to answer on a machine that was building and
  signing the application at the same time. Everything listed under 0.14.0, the fourteen-plugin
  Marketplace catalog included, arrives here.

## [0.14.0] - 2026-09-19

### Added

- Show a host's browser tab live to a remote member, with pointer and key input back to the page.
- Connect an MCP server before it is installed: the install dialog tests the configuration, and
  only a configuration that answers is saved.
- Open a Marketplace plugin from an `openbot://plugins/<slug>` link on its own detail page.
- Publish plugin pages on openbot.run from the shipped catalog: fourteen listings, each with its
  own mark.
- Give each agent one silhouette and a face that matches the work, in the sidebar and the activity
  indicator.
- List Marketplace plugins in the landing header on openbot.run.

### Changed

- Define when an agent's browser tabs close: no tab closes when a turn ends, the agent uses
  close_tab when a task no longer needs the tab, and deleting an agent closes its tabs.
- Show the download percent while a provider connects, with Cancel during the download and Retry
  on failure.
- Grow the plugin catalog to fourteen simple-auth listings: GitHub, Linear, Notion, Figma, Sentry,
  Context7, Stripe, PostHog, Airtable, Firecrawl, Brave Search, Resend.
- Name the shared tables "Tables" in agent settings.

### Fixed

- Let the embedded browser copy: pages can write to the clipboard on user gesture, and right-click
  offers copy link, copy image address, cut, copy, paste, and select all with full link targets.
- Align the Usage header icon with the provider logos.

## [0.13.0] - 2026-09-18

### Added

- Install an app and its skills together from the new Marketplace **Plugins** tab. Each plugin adds
  its MCP server record and the pinned skill versions its instructions need.
- Let agents keep records in one shared database at `~/OpenBot/Shared/Data/agent-data.db`. An agent
  creates, reads and writes its own tables, and the **Shared tables** view lists every table with its
  owner and lets you delete any of them.
- Let an agent tell a teammate something without asking for an answer. The message names that no
  reply is due, so the teammate does not open a turn for it.
- Let the agent complete provider authorization steps itself instead of stopping for the user.
- Show the remaining usage for every connected provider, and show the Grok account email.

### Changed

- Handle an exhausted provider usage limit: the agent reports the limit and the time it resets
  instead of failing the turn.
- Open a browser takeover page from its preview card. A takeover request no longer expands the
  browser over the conversation on its own.
- Open an attached file in the right panel instead of a modal.
- Group the agent chat message times, and correct the position of a message timestamp.
- Use a custom agent avatar in the activity indicator.
- Remove the **View source** toggle from a Markdown preview.

### Fixed

- Drop the placeholder answer that an agent sent for a teammate request.
- Load an OpenCode ACP session before reading it at startup.
- Remove the duplicated agent message previews.
- Save an edited agent instruction again.
- Keep a required input prompt visible.
- Type into the focused page when the browser cannot target an element.
- Keep the agent recipient menu text readable.

## [0.12.0] - 2026-09-17

### Added

- Open a Marketplace Skill or Agent on its own detail page, with a crumb back to the listing, a
  debounced search, and one install control that picks the target agent.
- Show category artwork on every catalog Skill instead of the generic fallback glyph.
- Preview Markdown and XLSX spreadsheet attachments in the file preview panel.
- Create a channel from the sidebar context menus and the sidebar topbar.
- Name the missing screen recording grant in Remote Control, open System Settings from the host's
  own Server settings, and re-read the grant with **Check again**.
- Show a themed splash backdrop on mobile startup.

### Changed

- Show the expanded browser edge to edge. Leave it with the button in the top right corner or with
  Escape, while a text field in the page keeps Escape.
- Reduce the hover area of the compact Dynamic Island.
- Respect per-server mute on the notch.

### Fixed

- Hide the mobile loader that stayed over the chat.
- Use the shared provider names on mobile and truncate long model labels.
- Hold the mobile splash until the artwork shows on a fast startup.

## [0.11.0] - 2026-09-16

### Added

- Edit a queued message before the agent starts it, on desktop, mobile, and over Team API.
- Download one file straight from a message with the per-file Download action.

### Fixed

- Keep the original file name on downloads instead of a generated one.
- Sign in to Google inside the embedded browser.
- Open WhatsApp Web login instead of the unsupported-browser page.

### Changed

- Hide sidebar row time and date when the panel is narrow.

## [0.10.1] - 2026-09-15

### Added

- Download all files from a message with three or more attachments as one ZIP file.
- Enter an OpenCode key for paid OpenCode models, with refresh and status in the provider row.
- Choose provider, model, and reasoning effort when you create an agent, where the host supports it.
- Read the WTF Is OpenBot guide under `/guides`.
- Open Settings from the application menu with a keyboard shortcut.

### Changed

- Show provider errors on one composer card instead of in the transcript.
- Write only the streamed message on each flush, and cut idle CPU and per-frame render work.
- Anchor the stopped task banner above the composer.
- Fix dismissible chat-scoped error banners so they stay dismissed in their chat.

### Fixed

- Fix OpenCode model list, agent setup picker, permissions text, and chat copy.
- Fix folder listening setup that failed on routine interval validation.
- Handle dynamic channel tools with no active assignment.

## [0.10.0] - 2026-09-15

### Added

- Manage MCP servers from server settings, including save, remove, enable, and test actions.
- Add mobile channels, agent pins, and workspace connectivity, with channel chat, records, and
  task actions. Preserve deleted channels as read-only previews.
- Add custom agent photos to the mobile avatar experience.
- Queue a message to a busy agent and show why it waits.
- Add an OpenCode download action to the custom provider row.
- Add an Introducing OpenBot article under `/news`.

### Changed

- Repository moved to `nightly-labs/openbot`; release links and the update feed follow it.
- Tighten agent-to-agent communication prompts and route agent instructions instead of
  front-loading them.
- Stop the two animations that burn idle CPU, and add `dev:cpu` to measure it.
- Explain a failed update check, make the retry answer, and stop routing updates through a
  rename redirect.
- Display channel titles in channel UI; draw a routing receipt as channel activity, not a message.
- Fix mobile sheet sizing, restore progressive blur on iOS, and update the iOS app icon asset.
- Fix browser preview layout, tab selection, address navigation, and sidebar icon styles.
- Keep chat input scroll position while editing earlier lines.

## [0.9.0] - 2026-09-14

### Added

- Run OpenBot on Linux x64. The release publishes an AppImage, the one Linux format that updates
  itself in place, and the in-app provider download covers Codex, Claude, Grok, and OpenCode there.
  Voice prompts and remote desktop are absent on Linux and report themselves as unavailable, and the
  AppImage is unsigned, as the Windows installer is. `docs/TROUBLESHOOTING.md` covers the AppArmor
  profile that Ubuntu 23.10 and later need.
- Give an agent skills. Write a skill locally, install one from the marketplace, and enable,
  disable, or remove it for each agent. Type `$` in the composer to insert a skill, and read a
  shared chat's skill actions in its preview. `@` still means agents and files.
- Choose the language of the application. Settings offers System, English, and Japanese, the menu
  and agent notifications follow the choice at once, and no restart is needed. A key that is not
  translated yet reads English rather than disappearing. The Japanese catalog is a first draft.
- Preview audio, video, SVG, and email files in the file panel and the attachment lightbox. Audio
  and video keep `previewKind: "none"` on the wire, so no released Team API adapter changes meaning.
- Read `/news` and `/guides` on openbot.run: article pages, an RSS feed, a sitemap, and structured
  data, with article artwork drawn from the title.
- Say what OpenBot costs on the landing page.

### Changed

- Start a new agent on low reasoning effort. Codex CLI reports `medium` for every GPT-5.6 model,
  which buys little on GPT-5.6 Luna, the model a new agent starts on, and costs a wait on every
  turn. An agent whose effort you already set is not moved, and every effort stays available in the
  picker.
- Rework the composer mention and skill picker. It hangs off the input, wears the queue panel's
  colors, names the type of each option and the source of each skill, and travels to its new height
  as the query narrows. The queue panel gives up that space while the picker is open.
- Drag the agent sidebar down to 128px before it snaps to the avatar rail. A width you already set
  stays inside the new range.
- Keep one provider CLI store for each computer, under `provider-runtimes` beside the application
  data. The packaged application already used that path, so nothing moves for an installed user.
  Several OpenBot instances can now install a provider at the same time without taking a running
  CLI away from each other. Development profiles no longer offer the same update after every
  restart.
- Move switches and camera panels with their own motion, and animate an article background
  continuously.
- **openbot.run now reports the five UTM tags on a campaign link** (`utm_source`, `utm_medium`,
  `utm_campaign`, `utm_content`, `utm_term`), which the previous privacy note said were never
  transmitted. Every other query parameter and the hash are still dropped, so an invitation token
  cannot reach analytics. This is the public website only: the desktop application is unchanged, and
  chats, files, and commands are never sent. `PRIVACY.md` and `ANALYTICS.md` describe what an event
  carries.

### Fixed

- Stop Grok's telemetry export failure from showing as a provider error. A computer that cannot
  reach an OpenTelemetry collector raised a "Provider error" toast on every switch to Grok. The CLI
  colour codes it printed as text are gone too, and a colour sequence can no longer hide a secret
  from the redactor.
- State a signed-out or spent provider above the composer. A lapsed account answered with its whole
  HTTP exchange, and the account menu printed the URL, the headers, and the 401 body. The composer
  now offers Sign in before you send, or names the reset time on a spent plan window.
- Keep undo working for composer typing, and stop a character being written twice.
- Play an attached recording. The packaged application blocked audio and video playback, and an
  attached `.eml` file could not be previewed at all.
- Retry the QR scanner after the camera fails to start.

## [0.8.0] - 2026-09-11

### Added

- Add channels: a shared chat that several agents join, coordinate a task in, and answer in
  together. A channel carries its own title, instructions, memories, and routines, and it pins to
  the sidebar the way an agent does. Channels travel over the Team API as `channel-chats-v1`, so a
  phone or a joined server on an older build keeps working without them.
- Describe your own OpenAI-compatible endpoint and pick its models anywhere a model is chosen.
  OpenBot encrypts the API key on this computer and gives it only to the local OpenCode process,
  and keeps it out of every export, log, and diagnostics report. Every saved endpoint sits under
  one Custom provider row, because which endpoint an agent uses is a model choice rather than a
  provider choice.
- Preview open browser tabs in a sidebar, and expand one into a full-width panel.
- Mute desktop notifications for one server without muting the others.
- Switch servers with numbered keyboard shortcuts.
- Count the new messages on the chat scroll button, so a thread that moved while you read tells you
  how far behind you are.
- Download and pin the OpenCode CLI, like the other three providers. The Install button that sent
  you to the OpenCode website is gone.
- Use OpenCode's free models with no account and no sign-in. A new OpenCode agent answers as soon
  as the CLI is downloaded.
- Add an optional OpenCode Zen key in Settings for the paid OpenCode Zen models. OpenBot encrypts
  the key on this computer, gives it only to the local OpenCode CLI, and keeps it out of every
  export, log, and diagnostics report.
- On mobile: open an agent's information and edit it in a sheet, reply to a message and use the
  message actions, send attachments from files or the camera, and pin an agent with a full swipe
  that a screen reader can also do.
- **On mobile, OpenBot now sends product analytics, and the setting starts on.** Turn it off in
  Settings at any time; events wait until you sign in and are dropped if you refuse. Nothing on the
  desktop app changed, and chats, files, and commands are never sent. `PRIVACY.md` describes what
  an event carries.
- Choose whether mobile gives haptic feedback.

### Changed

- Keep an OpenCode CLI you installed yourself. OpenBot reports its version, offers an update, and
  never forces the download.
- Leave the OpenCode Go models out of the model picker when a Zen key is what lists them. OpenCode
  reports Zen and Go as one catalog, but a Zen key does not buy Go, so those models answered every
  prompt with "Invalid API key.". They still appear when you signed in to Go in OpenCode itself.
- Start a new OpenCode agent on a free model, Muse for choice. OpenCode reports the services you
  signed in to before its own, so a new agent picked a model behind one of those sign-ins and its
  first message could fail with "Token refresh failed: 401" while the free models sat further down
  the list. No model that bills is ever the default now.
- Create an agent without instructions. The field was required for no reason a user could act on.
- Give every agent interaction card one shape across the app.
- Load mobile chat history as you scroll, instead of holding a whole thread in memory.
- Move the mobile save actions into the native sheet headers, and show pinned agents in a grid with
  a stated capacity.
- Raise the text contrast of the mobile theme.

### Fixed

- Show OpenCode tool activity again, and stop hiding browser actions.
- Keep channel reads, signed-out authorship, and sidebar order correct.
- Preserve Claude history answers, and render a resolved question as resolved.
- Let a remote agent avatar download over WebRTC. A paired phone asked a Team API v2 host for an
  avatar with no request body, and the host refused the route.
- Accept a custom avatar file an agent names in a prompt.
- Mute embedded browser tabs by default, and stop counting another agent's tabs against your tab
  limit.
- Show local dates on older chat messages and older sidebar chats.
- Remove the size label from the embedded browser.
- Make the desktop agent purpose optional, as the form already implied.
- Recover a mobile session and a server connection after the app loses one, and put the mobile chat
  keyboard back where it belongs after it is dismissed.

## [0.7.0] - 2026-09-09

### Added

- Add OpenCode as a fourth provider. OpenBot drives your own installed OpenCode CLI over ACP, so it
  is not downloaded or pinned like the other runtimes: install OpenCode and run
  `opencode auth login`, then pick it when you create or edit an agent.
- Add Team API v4, which carries the new provider and agent duplication. Version 1 to 3 stay
  registered and unchanged, so a phone or a joined server on an older build keeps working on the
  protocol it already speaks.
- Search models, grouped by provider and reasoning variant, in the model picker.
- Mention an agent in a mobile chat, see the other participants of an exchange, copy a highlighted
  code block, and retry a send that failed.
- Scan a pairing QR code from an inline sheet on the mobile sign-in screen.

### Changed

- Give every provider one name across the app. Initial setup and the thread status said "Codex"
  where the picker said "ChatGPT". All of them now say "ChatGPT".
- Ask the user to wait, with a countdown, when the mail provider refuses a sign-in code or a team
  invitation because the sending mailbox is over its quota. A refusal the sender cannot wait out,
  such as a full recipient mailbox, stays a delivery failure.
- **A paired phone can no longer disconnect a desktop session.** Sign out or revoke a desktop
  session from Settings on the computer that runs it. Phones and other sessions are unaffected, and
  no session is ended by this update.
- Install and activate OpenBot's pinned provider CLI update instead of asking the CLI to update
  itself. A CLI update waits while a provider sign-in is pending.
- Start the mobile app on the connected route, and block interaction while it loads.

### Fixed

- Report a provider CLI update that OpenBot refuses to start, instead of leaving the offer on screen.
- Keep an agent whose stored profile holds a value this release cannot read, instead of refusing to
  start. The startup error now names the field it cannot read.
- Keep an empty sidebar section visible when it holds no agents.
- Keep a chat-created agent in the section of the agent that asked for it.
- Prefer an agent in the same sidebar section when one agent messages another.
- Remember the selected agent for each server.
- Focus **Delete** in sidebar confirmation dialogs.
- Report an OpenCode turn that produced nothing as a failure, instead of a blank reply.
- Desynchronize desktop avatar animations, animate idle sidebar agents, and keep an avatar pose
  across a change of agent activity.
- Keep the Dynamic Island unfocusable while the mouse is over it.
- Explain what to do when a file preview or another surface fails, on desktop, mobile and the web.
- Keep a mobile profile name when the name field is left blank.
- Remove the scroll edge effect from the mobile add-server sheet.

## [0.6.1] - 2026-09-08

### Fixed

- Fix Usage reports failing to load in the desktop app because Electron could not clone the request.

## [0.6.0] - 2026-09-08

### Added

- Add agent and host-wide usage reports with model, provider and daily cost details.
- Add mobile server settings, member management and invite QR flows.
- Add marketplace presentation controls for agent categories and creator avatars.
- Show all integrated provider models and let users update a provider CLI from OpenBot.

### Changed

- Check for desktop updates every four minutes while OpenBot is running.
- Preserve mobile sign-out when offline by deferring account revocation.

## [0.5.0] - 2026-09-07

### Added

- Connect a phone to OpenBot. Pair a device from the desktop app, then read and answer agent chats
  from the mobile app, with connection status on every server surface and profile changes synced to
  each connected device.
- Review and revoke account sessions and paired devices from Settings. A revoked credential ends the
  remote sessions that used it immediately; other devices stay connected. Signing in again restores
  the device.
- Browser Automation V2: agents drive the built-in browser through native Chrome DevTools Protocol
  control instead of injected scripts.
- Create an agent through a guided setup with a customizable avatar, and manage agents and sidebar
  sections by asking in a conversation.
- Tag an agent or a skill directly in a chat message.
- Show detailed live agent activity, including the provider's reasoning.
- Import EML files as chat attachments.

### Changed

- Retheme the desktop app onto one colour, type and icon system.
- Rename an agent's **Description** to **Instructions**, and grow the field with its contents.
- Remove the limit on sidebar agent pins.
- Isolate the local team server per OpenBot account. The single-host file the previous build wrote is
  imported on first launch and left in place; nothing is deleted.
- Update the bundled provider runtimes: Codex to `0.153.4`, Claude Code to `2.1.263`
  (`@anthropic-ai/claude-agent-sdk` `0.3.263`) and Grok to `1.0.22`. The runtimes are downloaded on
  demand, so each one is fetched again the first time you use it after this update; the previous copy
  stays on disk, and a system-installed CLI of your own is not touched.
- Finish naming the product concept **agent** everywhere: identifiers, IPC channels, CSS, copy, the
  mobile app, and the instructions and tool parameters the models read. Existing agent identifiers are
  rewritten from `bot-<uuid>` to `agent-<uuid>` and every workspace moves from `~/OpenBot/Bots` to
  `~/OpenBot/Agents` on first launch. The Team API wire protocol is unchanged — versions 1 to 3 still
  spell the agent `botId`, and a translation layer converts.
- **Paired phones must be unpaired and paired again after this update.** A phone stores the agent
  identifiers it was given, and those identifiers have changed, so its pins and unread markers point at
  agents the host no longer knows. Chats open normally again once the phone is re-paired; nothing on the
  computer is lost.

### Fixed

- Discover the available ChatGPT, Claude and Grok models automatically again.
- Report weekly usage for the model that is actually active.
- Recover a provider session the CLI no longer knows, instead of losing the conversation.
- Keep chat table layout, message spacing and composer alignment consistent.
- Restore the main window when you activate OpenBot on macOS.
- Stop the Dynamic Island from clipping as it collapses, and idle avatars nobody is watching.
- Fix sidebar search focus highlighting and drag overlap, and the mobile sidebar swipe over agent rows.

## [0.4.3] - 2026-09-02

### Added

- Persist and restore the main application window position between launches.

### Fixed

- Apply the **Automatically download updates** setting: it is now persisted in the user data directory and drives the
  updater, instead of being a renderer-only value that reset on every launch and never started a download.
- Stop macOS updates hanging on **Preparing update…**: the restart action is offered as soon as the download completes
  rather than waiting for a native staging event that never arrived, and the phase that could hang is gone.
- Bound every update stage: a check, download, or restart that stops responding now reports an actionable error instead
  of waiting indefinitely. A failed download is retried in place; a failed install asks for a relaunch, because shutdown
  preparation cannot be repeated safely.

## [0.4.2] - 2026-09-01

### Changed

- Stabilize the signed macOS release gate by running the full repository test suite with bounded Vitest concurrency.

## [0.4.1] - 2026-09-01

### Added

- Add a self-hosted Bun Signal service, coturn, DNS-01 certificate renewal, and Docker Compose deployment under `remote/`.
- Add WebRTC Team API protocol v2 with RPC, ordered events, binary file transfer, backpressure, integrity checks, and resume support.

### Changed

- Identify signed-in desktop accounts in OpenPanel with normalized email profile traits and ordered event delivery; keep development builds and localhost analytics-free.
- Keep accounts, host configuration, memberships, invitations, logical sessions, and public assets in Cloudflare while remote data uses WebRTC only.
- Remove `cloudflared` from the active host transport and from macOS and Windows application packages.
- Require old Team API clients and hosts to update before they can use the retired tunnel endpoints.

### Fixed

- Keep the embedded browser panel closed until requested and prevent repeated toggles from opening duplicate tabs.
- Restore embedded X sign-in with persistent cookie consent, a compatible browser identity, and current login routing.
- Flush the embedded browser profile before restarts, system shutdowns, and application updates so authenticated sessions persist.

## [0.4.0] - 2026-08-30

### Added

- Add a macOS Dynamic Island overlay for messages, questions, approvals, browser takeovers, and failures.
- Add persistent question prompt bubbles with safe handling for secret answers.
- Let agents attach local response images with preview, download, and file actions.
- Negotiate compatible Team API protocol versions and capabilities between clients and hosts.

### Changed

- Redesign the account dock, usage popover, account menu, and Marketplace access.
- Improve browser takeover cards with persistent page previews and completed states.
- Hide People communication by default while retaining an explicit opt-in.
- Require macOS 13 or newer after the Electron and Chromium upgrade.

### Fixed

- Support embedded Google sign-in with the current Chromium identity while keeping the OpenBot browser session.
- Clear Bot unread state reliably when a chat opens or refreshes.
- Preserve agent names before title badges truncate in the sidebar.

## [0.3.5] - 2026-08-27

### Changed

- Download and verify the Whisper model on first voice use instead of shipping it in every application update.
- Remove provider runtimes from macOS and Windows application packages while keeping system CLIs as the first choice.
- Install application updates only after the user selects `Restart and install`.

### Added

- Download Codex, Claude, and Grok provider runtimes on demand from pinned vendor artifacts.
- Show provider download, setup, retry, and connection actions in onboarding, Settings, Bot setup, and model selection.

### Fixed

- Wait for native macOS update staging before offering a restart, and require an explicit update restart on Windows.
- Reject oversized or inconsistent release artifacts and remove duplicate native runtime files from packages.
- Stream large provider downloads to disk, support safe resume, and reject unsafe or invalid runtime archives.
- Respect Windows shutdown and sign-out without starting the NSIS updater.

## [0.3.4] - 2026-08-26

### Fixed

- Verify source-built Windows remote desktop binaries as intentionally unsigned while preserving strict vendor signature checks.

## [0.3.3] - 2026-08-26

### Fixed

- Isolate Windows package signature checks from the PowerShell 7 module path used by GitHub Actions.

## [0.3.2] - 2026-08-26

### Fixed

- Stage Claude and Grok runtimes on the destination volume before the atomic Windows install switch.

## [0.3.1] - 2026-08-26

### Fixed

- Resolve bundled provider and fallback CLI paths with the target platform's path format.

## [0.3.0] - 2026-08-26

### Added

- Add the Grok CLI provider and bundle the supported provider CLIs for a more reliable onboarding experience.
- Add attachments directly in the conversation composer and connect the agent marketplace.
- Add per-participant emoji reactions, including optional context-aware bot reactions to user messages.
- Add improved server invitation and member workflows.

### Changed

- Rebuild chat messages on reusable bubble primitives and refresh settings, routines, and related popovers.

### Fixed

- Preserve the active server across refreshes and make server address copying reliable.
- Improve composer mentions, worktree setup, invitation handling, and emoji reaction presentation.

## [0.2.1] - 2026-08-25

### Added

- Add scheduled agent routines with timezone-aware schedules, manual test runs, run history, and delivery in the agent chat.
- Add agent memories, shared sidebar sections, and the skills marketplace.

### Changed

- Refresh the sidebar, agent settings, dialogs, buttons, switches, selects, and Storybook examples with the shared visual system.

### Fixed

- Prevent resumed routines from running missed schedules and protect unsaved routine edits before navigation.
- Render newly appended chat messages without virtualizer refresh loops.

## [0.2.0] - 2026-08-24

### Added

- Add the production Create Bot flow with practical suggestions, synchronized animated avatars, and first/additional Bot modes.

### Changed

- Create a Bot only after its complete profile is submitted, then queue its initial role message as one rollback-safe operation.
- Replace the legacy new-agent picker and empty-chat onboarding with the dedicated Bot setup screen.

### Fixed

- Keep the technical development client out of a normal private dev server while preserving the two-client test harness.
- Limit the first visible Bot message to its ongoing role.

## [0.1.22] - 2026-08-24

### Added

- Add a resizable browser Picture-in-Picture panel that stays visible while the conversation remains usable.

### Changed

- Keep application and conversation state stable during renderer hot updates, including selections, drafts, search, panel state, and active resources.
- Simplify the Remote Control toolbar and show agent animation while a remote desktop connection starts.

## [0.1.21] - 2026-08-23

### Fixed

- Restore the Solid signals runtime dependency required by production builds.

## [0.1.20] - 2026-08-22

### Changed

- Split team IPC registration, renderer message projection, voice status helpers, and workspace path handling into focused modules.
- Remove unused dependencies, renderer exports, preview helpers, and an inactive visual test suite while keeping active Storybook coverage.

### Fixed

- Hide unexpected Team API failures from remote clients while preserving controlled validation errors.
- Bound unauthenticated sign-in rate-limit state and reject oversized WebSocket event frames before application parsing.
- Make team and remote-server state writes atomic, isolated, and able to recover after a failed write.

## [0.1.19] - 2026-08-22

### Changed

- Load the interactive landing preview from server markup and retry its ready handshake until playback starts.
- Cache the verified Whisper model in application CI and release workflows.

### Fixed

- Exit a second desktop app process immediately when another OpenBot instance already holds the profile lock.
- Keep the agent activity avatar visible for 500 ms after streaming ends and preserve its layout space when it exits.
- Show the message queue only while a delivery is starting or running, so the first message does not flash in Queue.

## [0.1.18] - 2026-08-22

### Added

- Add paginated conversation loading, global message search, direct-conversation history, and persisted read state.
- Add Markdown rendering with code blocks, tables, task lists, links, images, and attachment references.
- Add privacy-safe desktop and landing-page analytics with test coverage.
- Add a central Content Security Policy for the Electron renderer.

### Changed

- Rework chat rendering and virtualization for smoother streaming, stable bottom following, and large histories.
- Show one stable animated agent avatar and status label for each active response, including reduced-motion support.
- Improve the development landing preview, conversation stories, and seeded demo content.
- Add a staged hero entrance and a skeleton-to-preview reveal on the public landing page.
- Extend local and remote team chat contracts for message history, search, reactions, files, and read state.

### Fixed

- Keep queued messages in their panel until work starts and display each user message before its matching response.
- Animate queue entry removal and panel resizing without abrupt chat movement.
- Keep the activity avatar visible until response streaming ends, then close it with a soft transition.
- Smooth message height changes and preserve bottom scroll while streamed content grows.

## [0.1.17] - 2026-08-22

### Fixed

- Authenticate pinned runtime release lookups in GitHub Actions to avoid unauthenticated API rate-limit failures.

## [0.1.16] - 2026-08-22

### Changed

- Open an agent chat directly from incoming and outgoing exchange markers instead of showing a separate exchange history dialog.
- Use Luna with low reasoning effort for every deterministic development seed agent.

### Fixed

- Run development-state reset tests in the Node environment so CI and signed release builds can load `node:sqlite`.
- Keep message links, inline citations, and source references routed to the system browser, with a clear error when opening fails.

## [0.1.15] - 2026-08-22

### Added

- Add conversational bot profile updates for `name`, `title`, and `description`, plus profile-based agent discovery and message routing.
- Add a guided first-run onboarding flow and deterministic development seed data for integrated UI testing.
- Add managed transfer manifests, shared-file references, ownership metadata, and integrity checks for message and generated attachments.
- Add the shared Kobalte Select component with Storybook coverage and use it for reasoning controls.

### Changed

- Replace bot profile `role` with `title` in storage, local and remote Team APIs, renderer search, and agent instructions. Team permission roles stay unchanged.
- Start the Auth API with the development app and select available local ports when defaults are busy.
- Compact stored conversation and mailbox event history during the schema version 4 upgrade.
- Simplify queued message handling by removing the paused queue state and resume action.

### Fixed

- Validate copied attachment size and SHA-256 data, and remove bot-owned generated files when an agent is deleted.
- Improve agent settings controls, reasoning selection, profile editing, and file reference rendering.

## [0.1.14] - 2026-08-22

### Added

- Add full-window P2P Remote Control for active server members, with shared mouse and keyboard control,
  four concurrent sessions, monitor selection, hide and resume, retry, and explicit disconnect.
- Bundle pinned Sunshine and Moonlight Web runtimes built from source, with immutable artifacts,
  corresponding GPL source, checksums, SBOMs, and build provenance.
- Add speech-to-text message input with local Whisper model preparation.
- Add universal server invitation links and updated account, server, queue, attachment, and conversation
  controls.

### Changed

- Changed the project license from Apache-2.0 to PolyForm Noncommercial 1.0.0.
- Publish the OpenBot application for macOS only in this release while Windows application packaging is
  paused.
- Start Remote Control only from the server header and keep a hidden session active until the user
  disconnects or changes servers.

### Removed

- Remove QuickDesk, VNC, noVNC, remote passwords, and view-only remote access paths.

### Security

- Authorize Remote Control through active team membership and one-time in-memory viewer grants.
- Verify the local Sunshine TLS chain and pin the exact generated certificate.

## [0.1.11] - 2026-08-16

### Added

- Render Markdown and plain web links with site favicons, safe fallbacks, and system-browser opening.

### Fixed

- Automatically unarchive stored Codex sessions before resuming work or reading conversation history.
- Use trusted Chromium input events and one consistent page and network identity in the embedded browser so X sign-in and account confirmation work.
- Send signed-out X landing pages to the stable login route while preserving signed-in sessions.

## [0.1.10] - 2026-08-14

### Fixed

- Detect Codex and Claude in current Windows installer locations and in npm paths that contain spaces.
- Report a CLI that exists but cannot start instead of incorrectly reporting it as not installed.

## [0.1.9] - 2026-08-14

### Fixed

- Allow Codex or Claude selection on the initial setup screen while provider checks run or setup is still required.

## [0.1.8] - 2026-08-14

### Added

- Add GitHub-hosted Windows x64 CI builds and unsigned NSIS release installers.
- Add Windows package launch, metadata, updater, and Electron fuse checks.

### Changed

- Publish macOS and Windows assets together only after both release jobs pass.
- Detect local Codex and Claude CLI installations and enable installed updates on Windows.
- Keep native window controls visible on Windows.

## [0.1.7] - 2026-08-14

### Changed

- Make the message composer grow up to six lines and preserve multiline typing and paste input.

### Fixed

- Prevent horizontal scrolling in chats and wrap long URLs and paths inside message bubbles.

## [0.1.6] - 2026-08-14

### Fixed

- Keep the first sent message visible and close onboarding after a successful send.

## [0.1.5] - 2026-08-14

### Changed

- Require an explicit model choice before a new empty agent can accept messages.
- Show the specialty step immediately after model selection and after creating an agent.
- Allow browser and settings panels to expand while keeping a usable conversation area.
- Close an agent settings panel when switching chats and use clearer provider marks in model pickers.

### Fixed

- Show complete Claude responses immediately when stream deltas are missing or incomplete instead of requiring a chat refresh.

## [0.1.4] - 2026-08-13

### Fixed

- Present embedded browser requests as standard Chrome requests so X login and signup flows work.
- Restart expired X onboarding routes from the stable login entry after an app restart.
- Persist embedded browser tabs, active tab selection, URLs, and agent ownership across app restarts.
- Revalidate top-level browser navigation to avoid stale cached pages.

## [0.1.3] - 2026-08-13

### Added

- Agent headers, settings, and onboarding now use one model picker with provider availability, CLI version, and account details.

### Changed

- Changing the preferred provider now updates the active account details and default model immediately.
- Development mode now watches source files for changes.

## [0.1.2] - 2026-08-13

### Changed

- New Claude agents now use Claude Opus 5 as their default model.
- Agent onboarding and runtime settings now use one consistent compact card layout.

### Fixed

- Creating an agent now opens its settings panel immediately.

## [0.1.1] - 2026-08-13

### Added

- Claude CLI support with automatic Codex and Claude availability checks.
- Per-agent provider and model selection during onboarding and in agent settings.
- First-launch provider selection with macOS permission status and later account-menu access.

### Changed

- Simplified provider selection to show clear availability without decorative provider cards.
- Development state reset now deletes `OpenBot Dev` state without creating a backup.

### Fixed

- Shutdown now waits for active queue writes before closing local storage.

## [0.1.0] - 2026-08-13

### Added

- Signed GitHub Releases update pipeline with in-app availability, download progress, and restart-to-install controls.
- Public repository documentation, community health files, CI, and draft release automation.
- Apache-2.0 licensing and an attribution notice for Norbert Bodziony.
- Local Codex App Server lifecycle and ChatGPT subscription authentication.
- Per-agent context-budget monitoring and proactive App Server thread compaction.
- Persistent agents with independent threads, workspaces, profiles, models, and reasoning settings.
- FIFO queues, agent-to-agent messaging, replies, reactions, attachments, and file transfers.
- Embedded browser control and optional macOS Computer Use integration.
- SolidJS desktop interface with resizable agent, browser, and settings panels.
- Explicit first-launch consent before the full-access Codex service can start.
- Local ZIP backups, privacy-safe diagnostics, release SBOMs, and multi-version macOS CI checks.

### Changed

- Standardized the product name and all user-facing branding as `OpenBot`.
- Replaced the remaining third-party-inspired avatar SVG with an original OpenBot placeholder mark.
