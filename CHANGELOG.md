# Changelog

All notable changes to OpenBot will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md).

## [Unreleased]

## [0.33.0] - 2026-10-07

### Added

- Add a webhook trigger to teammate and group routines. In **When to run**, open **Change trigger** and select **Webhook**. The routine gets its own endpoint and signing secret. A signed request to the endpoint starts the routine. Select **Filter events** to limit the routine to one event type and to data filters.
- The **Change trigger** menu shows each schedule and the webhook with one line that tells when the routine runs.
- You see the signing secret of a webhook routine one time when you save it, and you can make a new secret. When you change the routine to a schedule or delete it, its endpoint stops working.
- The routine **History** shows runs and the webhook requests that the routine ignored. Event data stays on the host computer. The host must be online to receive webhook requests.

### Changed

- New Claude agents use Haiku 5.5 by default.

### Fixed

- Show a yellow update notice with an Update button when the selected provider needs a newer runtime. Keep the draft and block sending until the required update is complete, instead of asking the user to reinstall OpenBot.
- Hide the failed-send error while the required update notice is shown. Keep Edit and Dismiss available, and restore Retry after the update. Show manual update instructions when OpenBot cannot offer an update.
- Pause webhook requests when you sign out. Sign in again to resume the saved routes without changing their URLs or secrets.
- Protect saved MCP sign-in credentials from a changed authorization server. Older credentials refresh only when their original authorization server is known.

## [0.32.0] - 2026-10-07

### Added

- Docker version tags now also accept the `v` prefix used by GitHub releases.
- Report safe provider failure causes and error/warning notifications to OpenPanel, including invalid upload requests from ChatGPT and OpenCode.
- Keep bounded local error queues and retry delivery after network failures or restarts. Tracking changes clear pending reports.
- Add a separate analytics setting for the browser app. Error reports exclude messages, prompts, paths, and raw exception text.

### Fixed

- Fixed Codex Computer Use approval storage, including `set_value` on Windows. Saved tool approvals now remain available after a restart. Configuration failures show recovery steps.
- Keep remote Browser Live View available after the host's Team API restarts. Show stream and connection failures instead of a normal end message, and redact secrets from browser start errors.
- Explain OpenCode's invalid upload error as a model provider failure, with steps to change models and check saved routines before creating them again.
- Docker releases now check that image tags are readable without a GHCR sign-in. Previously, a release could pass while the package was private.
- Increase the provider message size limit from 128 MB to 256 MB to allow larger individual records.
- Allow model and provider changes after recovery from a stopped provider. Before, a stale active turn could block the change after Codex exceeded the message size limit.
- Read provider history in pages and keep completed history on disk. Long chats no longer require a retained copy of the full provider transcript.
- Preserve saved messages and attachments when a history import fails or resumes after a restart.
- Require Codex CLI 0.156.0 or newer for bounded history reads. The bundled runtime is updated to 0.160.1.
- Bundle the internal error-reporting package so the desktop can start correctly.

## [0.31.0] - 2026-10-07

### Added

- Visual replies. An agent can show a chart, a table, a diagram or a mockup as an HTML page above its
  reply. The page runs its scripts in a sandbox and can load files from the network. A link in the
  page opens in your browser after you click it. Agents can look at a page before they show it.
- An HTML file opens as a page in the file preview. Use "Show HTML source" to see its code.
- Copy a table from a reply as Markdown or CSV.
- Click an image in a reply to open it in the image viewer, with the other images of the message.
- Play attached audio and video directly in chat, without opening the preview panel.
- Cursor and Cline agents on a joined server now show in the app and the browser client, and you can create them there. Before, they stayed on the host computer only.
- An owner or admin can download Cursor and Cline on a joined server and sign them in from their own device. Cursor shows a sign-in page that signs the server in by itself, so a server with no screen can use your Cursor plan. Cline shows a device code.
- Agents can show HTML pages and Mermaid diagrams in a reply. A code block marked `html` shows as a
  rendered page, and a code block marked `mermaid` shows as a diagram. Use the Preview and Code
  switch to see the source. Select the expand button to open the page or diagram in a larger
  window, which grows out of the block. A page runs no scripts and loads nothing from the network.
  Its links open in your browser.
- A chat with three or more days of history shows a day rail on its right edge while you scroll. Each segment is one day, so you can see how long the chat is and where you are in it, also before older messages load: a top segment stands for them. Point at the rail to see the days, and click a day to scroll smoothly to it; the day count rolls to each new number. This is in agent chats, team channels and direct messages on this computer; on a joined server the rail shows the loaded days.
- Settings > General has a new "Steer agents while they work" switch. When it is on, a message sent to a busy ChatGPT or Claude agent joins the current work at the next step, and does not wait in the queue. The switch is off by default, so messages queue as before. It also applies to messages from teammates on a server that this computer runs.
- Each agent has a "While working" setting in its settings panel. It uses the app default, or it always queues or always steers for that agent.
- A message that cannot steer waits in the queue with a "Not steered" label and the reason. Grok, OpenCode, Gemini, Cursor, Cline and custom agents cannot steer a running turn. The message starts when the current turn ends.
- A message that could not be sent stays in the chat with Retry, Edit and Dismiss. Retry does not send the message two times, also when the first attempt reached the server and only its answer was lost. A server on an older version cannot detect a repeated message, so for it the chat offers only Edit and Dismiss. If you quit or restart before such a message is sent, its text is back in the composer when you return; nothing sends it again on its own.
- openbot.run has a new /providers section with one page for each coding agent that OpenBot runs:
  Claude Code, Codex, Gemini, Grok, Cursor, OpenCode, Cline, and local models from Ollama or
  LM Studio. Each page shows how to set the agent up in OpenBot, what OpenBot adds to it, the
  vendor's own apps and where they run, and answers to common questions. The footer, the provider
  tile on the home page and the matchup comparisons link to these pages.
- openbot.run has a Markdown copy of each guide, news post, comparison and provider page, at the page URL with `.md` added. `/llms-full.txt` holds all of them in one file for AI assistants.
- The openbot.run FAQ now says what the source license permits.
- A folder chip, such as `research/eyeliner/`, now opens a folder view in the file panel. The view shows the files with their size and date. Select a file to open it, and select **Back** to go back to the folder.
- The file panel can show the source of a Markdown file. It also has **Download file** for each file, and **Show file in Finder** on the desktop.
- Add a calendar feed for routines in Server Settings > Routines. Apple Calendar (On My Mac) and other calendar apps that read the feed on this computer can subscribe to the next 30 days of runs of active routines, for all agents or for one agent. The private URL works only on this computer, and **New URL** stops the old one.
- Connect a Discord server in **Server settings → Connectors → Discord**. People mention @OpenBot in a
  channel, and the Discord Orchestrator agent asks the right agent and answers in the reply chain.
  Replies to OpenBot continue the conversation. Approvals, **Stop**, reactions and files work as in
  Slack.
- Connect Bitwarden in Marketplace or Server settings to fill browser passwords and authenticator codes. Share logins through a folder named `Shared with OpenBot`. The CLI session lasts until disconnect, eight idle hours, or app exit.

### Changed

- A Mermaid diagram that cannot be drawn shows the parser message. When the diagram module did not
  load, a retry button shows.

- The agent cursor in Computer Use now travels to each point with a smooth, curved move, as a
  person moves a mouse. A long move across the screen takes a wider arc. Before, the cursor slid in
  a straight line in a fixed short time. With reduced motion on, the cursor still jumps.
- Computer Use now uses cua-driver 0.34.0.
- "Use a skill" in the composer's add menu now opens the skill list. Before, it was always unavailable, and you had to know to type `$`.
- The skill list shows skills whose name matches your text first, then skills that match only by description. When two skills have the same name, each row also shows its folder name.
- A long reply that streams does less work for each new part. Only the end of the text is read
  again, the code in a code block is colored one new line at a time, and lines that did not change
  are not drawn again. The line that is still arriving has no color until it is complete. Before,
  each new part read and colored the full reply again.
- A message you send shows in the chat at once, marked as sending, and the composer stays free for the next one. Before, the composer waited until the server accepted the message. Several messages sent quickly reach the agent in the order you sent them.
- In the web client, a send that fails no longer blocks the composer until you check the conversation. The message stays in the chat with its failure.
- Use less CPU and memory while channel agents write replies. Before, OpenBot read the whole
  conversation and the whole channel history again about ten times each second for each agent.
- Close the Computer Use highlight windows one minute after no agent controls the computer. Before,
  they used memory for as long as Computer Use was on.

### Removed

- Remove the Download all action from chat attachments. Individual file downloads remain available.
- The website no longer opens the Product Hunt launch dialog when a page loads. The Product Hunt
  link above the landing page title stays.

### Fixed

- Failed Antigravity MCP tool calls no longer show a separate provider error notification.
- Remove claims from the website and documentation that OpenBot does not need an account.
- Explain an OpenCode model whose provider rejects its API key, such as a Google Gemma model, and
  tell how to fix the key. Before, OpenBot showed only "Internal error: API key not valid".
- The **Add member** menu in channel settings has a search field, and its list scrolls. Before, the menu had no search and did not scroll, so agents above or below the window edge could not be added.
- Sign in and connect to teams on a company network that inspects TLS, such as Fortinet. OpenBot
  now trusts the root certificates of the operating system, as a browser does.
- Show which host a company firewall or proxy blocked when sign-in cannot reach the account service.
  Before, OpenBot asked you to check that the API was running, and a proxy's block page could sign
  you out.
- Move the window by its title bar when the browser fills the window. Before, only the area under
  the window buttons moved it. You can also move the window by the header of the browser sidebar.
- Long text in chat tables now wraps inside its cell. Before, a table could become wider than the
  message, and you had to scroll sideways to read it. Long links and code also break inside the
  cell.
- Put the cursor back in the message box when you come back to the OpenBot window. Before, you had
  to click the message box again before you could type.
- A queued message that you steered just as the agent finished its turn no longer shows as done when the agent never read it. It stays in the queue and starts next.
- The request that an agent sends to another agent, and the result that comes back, no longer add to
  the unread count of either agent. Before, an agent showed new messages in the sidebar when its chat
  had no new message for you.
- The skill list now says when the agent has no skills, when no skill matches, or when the skills did not load. Before, the list did not open.
- Keep the message you did not send when you go to a different chat. Each agent chat and each
  channel keeps its own draft. The draft text also stays after you restart OpenBot, for example to
  install an update. Attached files stay only until you close OpenBot.
- The Mobile tab of the changelog shows a new version only when you can install it from the store.
  Before, it showed the version while the store still reviewed the build.
- **Attach image** now shows PDFs, documents, and all other supported files. Before, on Windows, the file picker showed only images until you selected **All files**.
- A teammate's reply could show in an agent's chat as your own message, with the full teammate prompt. It now shows as a message from the teammate, also for replies that earlier versions saved this way.
- When the connection of an ACP agent to its model dropped and the agent tried again, its
  "API Error" line was joined to the retried answer in one chat bubble. The line now shows as a
  separate muted activity line.
- When a file or folder does not exist, the error now names the path and the agent workspace. Before, a folder chip showed "Workspace path is not a file."
- Type the phrase that an input method picks with Shift and a digit, such as an OpenVanilla
  associated phrase. Before, the message box typed the punctuation of the key, such as "!".
- A host that clients reconnect to many times no longer runs out of network sockets and becomes unreachable until a restart. After 10 ICE restarts, a remote connection is replaced with a new one.
- Connect again to a joined server after the computer wakes from sleep. Before, the server could stay unavailable until you restarted OpenBot.
- Sign in to Framer in the embedded browser. Before, Framer refused every sign-in with "Cannot log
  you in" or "Verification failed", because the browser identity included the OpenBot name.

### Security

- The Windows installer and app are now signed by SYNTHETIFY LABS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ. Windows no longer shows "Unknown publisher" for them, and later updates install only when they have the same signature. Before, the Windows release was not signed.
- The account service now checks the skills and agent marketplace admin token in constant time. Before, the check time could show how much of a guessed token was correct.
- Bitwarden fills require an exact HTTPS origin and a current item in the shared folder. Session keys and login values are not saved by OpenBot, and short authenticator codes are redacted from logs.

## [0.30.0] - 2026-10-05

### Added

- An agent can suggest a Marketplace app in the chat. The card shows the app, its state, and
  Connect. Connect opens the app in Marketplace and starts its sign-in there. You can dismiss the
  card and undo.
- When an agent needs GitHub and it is not connected, the agent shows a GitHub card in the chat.
- The openbot.run home page shows what OpenBot does, answers common questions, and links to each comparison.
- An official Docker image, `ghcr.io/nightly-labs/openbot`, for `linux/amd64` and `linux/arm64`. It
  runs OpenBot as a self-hosted server with the Electron sandbox on. Sign it in with
  `docker exec -it openbot openbot login`. See `docs/docker.md`.
- openbot.run has a download page for each system: `/download/macos`, `/download/windows` and
  `/download/linux`. Each page gives the system requirements, the install steps and the known limits,
  and `/download` links to all three.
- openbot.run has a download for Linux on arm64.
- openbot.run has four new pages in /compare: Codex vs Claude Code, Claude Code vs Antigravity,
  Cursor vs Claude Code, and the best AI agent apps of 2026. Each pair page compares the two apps
  from their official sources, and shows how OpenBot runs both as one team. The roundup lists 13
  apps and links each one to its comparisons. The Codex, Antigravity and roundup pages show a
  chart of scores, cost per task and time per task from the Artificial Analysis Coding Agent Index.
- Connect 1Password in the Marketplace or in Server settings > Connectors. The page shows three
  steps: **Install** puts the 1Password CLI in place for you, with no administrator password; then
  turn on the CLI integration in the 1Password app, which the page sees when you come back; then
  **Connect 1Password** creates a "Shared with OpenBot" vault and a service account that can read only
  that vault. You can paste a service account token instead. Agents then sign in to sites in the
  OpenBot browser with the logins you move into that vault. The browser fills the password or
  authenticator code; agents never see it.
- Full Turkish language localization across OpenBot, covering 100% of messages including new features, connectors, Marketplace v3, schedule calendar, and all error catalogs.
- Choose the message send shortcut in Settings > General > App behavior (desktop) or
  Account > Preferences > App behavior (web): Enter to send, or ⌘Enter on macOS /
  Ctrl+Enter on Windows and Linux to send with Enter adding a new line. The choice
  stays on the device and browser. An Enter that confirms IME text never sends.
- When a Claude or Codex account reaches its usage limit, OpenBot shows one desktop notification for
  the account, with the number of agents that wait and the reset time when the provider gives it.
  Each agent on that account shows "Waits for limit" and the reset time in the sidebar.
- A routine has a new setting, "If the account is at its limit", on this computer: wait and run
  after the reset, or skip the run. Wait is the default.

### Changed

- On openbot.run, News, Guides, Compare and Plugins in the header now open their pages when you
  click them. Hover over them to see the panel.
- The openbot.run footer names Synthetify Labs as the owner.
- A chat now shows consecutive messages to and from other agents as one row, such as "7 messages with 7 agents". Click the agents to see each message.
- The openbot.run footer links to the self-hosted server guide.
- The direct installer links are now `/download/<os>/latest`. An old `/download/<os>` link opens the
  download page for that system, not the installer.
- The Schedule view of a server is now called Routines, the same name as in agent and channel
  settings.
- A failed task card in the Dynamic Island now has a "Dismiss" button. The button removes the card
  from the island only. The conversation keeps the error, and the agent list keeps the failed mark.
  The island then shows the newer replies of the other agents (#1348).

### Removed

- Removed the public guide-authoring page. Its instructions now live in the contributor documentation.

### Fixed

- The openbot.run home page title reads "Meet OpenBot" to search engines, and its text shows when JavaScript is off.
- The openbot.run home page title shows sooner: it no longer waits for the page script.
- `www.openbot.run` and `http://openbot.run` now go to `https://openbot.run`.
- Page addresses that end in `/` now redirect permanently to the address without it.
- The guides, news, plugins and changelog pages have clearer titles in search results.
- The server member count now uses the singular form for one member. Before, a server with one
  member read "1 members" in English.
- The Dynamic Island toggle now reads "Expand" and "Collapse" in the interface language. Before, it
  always used these two words in English. A screen reader then read English inside a control that
  was otherwise in the chosen language.
- The composer error banner showed two English messages that no catalog owned. With the interface
  in another language, they stayed English above a translated composer. Both now come from the
  composer catalog. The attachment limit message also reads the limit from the shared limit, so a
  change to that value updates the text.
- The desktop app no longer closes when a remote server announces a new name and the saved server list
  cannot be written, for example when the profile directory is read-only or the disk is full. The new
  name still appears in the app, and the next write of the list saves it.
- A plugin listing with a server argument that is not text now stops the plugin catalog build. Before, the build dropped the whole argument list, so the listing shipped a server that started with no arguments.
- The app no longer freezes when an agent declares a very long task resource list. OpenBot now
  refuses an oversized list at once, instead of resolving every path in the list first.
- Signing out, disconnecting or quitting now ends a file download that is still waiting. Before, the
  download waited for its full 60 s timeout and its timer kept OpenBot from closing.
- Closing a remote connection while Signal checks its ticket no longer uses one of the account's
  remote connection slots. Before, the closed connection kept its slot, and the desktop was told
  that a phone was ready. A later device was then refused because the account was full.
- A remote client whose agent snapshot is too large to send no longer stops the other remote clients
  from receiving that agent event. Before, every client that connected after it missed the event and
  kept a stale queue until the next event arrived.
- A chat could stop updating on screen when notifying the window failed. Every update now runs, so
  the chat stays the same as the saved messages.
- The skill marketplace no longer skips skills when a client pages with a cursor from before cursor
  v1. That cursor held only a timestamp. The catalog order also leads with the featured flag, so the
  timestamp could not say where the last page stopped. The page now comes again and the rest of the
  catalog follows.
- The agent marketplace no longer skips agents when a client pages with a cursor from before cursor
  v1. That cursor held only a timestamp. The catalog order also leads with the featured flag, so the
  timestamp could not say where the last page stopped. The page now comes again and the rest of the
  catalog follows.
- On macOS, the message that blocks an update while another OpenBot session runs now tells you when the other session runs in your own user account. Before, it always told you to stop OpenBot in every other macOS user account, even when the blocking process ran in your own account.
- Open Desktop now shows why a remote desktop did not start: Sunshine did not start, Moonlight Web
  did not start, or pairing failed. Before, it showed only "request failed".
- When Sunshine stops on the host, OpenBot ends its remote desktop sessions and starts Sunshine again
  for the next session. Before, each new session stayed at "Connecting".
- Open Desktop shows an error when the host does not start the stream in 60 seconds. Before, it
  stayed at "Connecting" until you closed it.
- Signal no longer refuses a new phone or browser with "Too many active remote connections." when one
  account has several computers and devices. The account limit is now 32 Signal connections, not 8.
  A phone that reconnects after a network change no longer loses its own place to its old connection.
- After a restart, a Claude agent chat no longer shows the context summary, "[Request interrupted by user]", or the output of a command such as `/compact` as a message from you, and no longer repeats an answer it already showed. The next restart also removes these messages from chats that already show them. An answer that was already repeated stays.
- You can install the OpenBot website as an app from Chrome, Edge and Android. Before, the site
  manifest told the browser to keep the site in a normal tab, so the browser did not offer to
  install it.
- On a phone, the email sign-in code now fills from the keyboard suggestion or from autofill, also
  with its hyphen. Each character typed on an Android keyboard now goes into the next box. Before,
  each character replaced the first box.
- Canva opens in the embedded browser. Before, Canva showed an "Update your browser" page and did
  not let you edit a presentation, because its server refused the OpenBot token in the user agent.
- Gemini agents no longer fail every turn with "Invalid value at 'tools[0].function_declarations[…]…enum[0]' (TYPE_STRING)". Two OpenBot tools sent numbers in a list of allowed values, which Gemini accepts only as text.
- When you change an agent's provider, the new provider now gets the work the previous one did: the commands it ran with their results, the files it changed, and its progress notes. Before, it got only the chat messages, so it did not know much of the earlier work.
- When you ask an agent on a connected server to create a routine, the routine now runs in your
  timezone. Before, it ran in the server's timezone, so a routine for 8:00 could run hours early or
  late. This works from the desktop app and the web client when both the app and the server are
  updated.
- When you change an agent's provider, OpenBot now saves the earlier provider's work log at the moment of the switch. Before, if that provider stopped soon after the switch, as an unused provider does after a minute, the new provider could get the chat without the earlier work.
- A custom agent that serves one folder for each process, such as Command Code (`cmd acp`), lists its
  models while a bot uses it, and runs bots in more than one folder. Before, the model list failed
  with "This cmd acp process serves ...; start another for ...", because OpenBot used one process
  of the agent for all folders.
- A steered message to a custom ACP agent that accepts one prompt at a time is not lost. Before, the
  agent refused it with "A prompt is already running for this session", OpenBot showed a provider
  error, and the message was not sent. Now OpenBot sends the message when the running reply ends.
- On the website, the page keeps its scroll bar and does not move when you hover over or focus
  "App" in the header. Before, the scroll bar went away, the page moved sideways and stopped
  scrolling.
- Codex and ACP agents now receive a clear reason and can retry when an agent profile request is invalid, for example when profile instructions exceed the length limit or a model is not available, instead of receiving a generic provider error.
- The files of an "Update from" message now sit at the left edge, under the update, where an
  agent's own files sit. Before, they were pushed to the right.
- A chat row no longer takes the data of the next message when messages in the middle of the chat
  change order. Before, a row could hold the raw text that an agent sent, or the file of another
  message, until the list updated.
- A chat message that cannot be shown now shows "This message could not be shown". The rest of the
  chat stays usable.
- A message, a routine run or a local script run that reached an account at its usage limit failed
  with "Internal error: You've hit your session limit", and OpenBot did not run it again. Now it
  waits in the queue and starts after the reset. A turn that had already run a command still fails,
  so the command does not run twice.

## [0.29.0] - 2026-10-02

### Added

- Compare OpenBot with ChatGPT dots on openbot.run/compare.
- Each comparison on openbot.run/compare has a "Where you can use it" row. It shows the countries
  and languages of each product, and that OpenBot has no region lock.
- A script on your computer can now run an agent's routine and give it a payload, for example to wake the agent when a long build ends. Turn on Local scripts in the agent's settings, then use Copy run command on a routine. The setting is off by default.
- The openbot.run header menu has a Compare section, and each comparison links to the other comparisons.
- Install OpenBot as a server on a Linux computer with no screen, such as a VPS, from a terminal:
  `curl -fsSL https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh | sudo bash`.
  Sign it in with `sudo openbot login`, and use it from the desktop app, the iPhone app or
  openbot.run/app. The `openbot` command also shows the status and the log, changes the server name,
  installs updates, and removes OpenBot with `sudo openbot uninstall`. The install also works on Debian
  12, Debian 13 and Ubuntu 26.04. See docs/self-hosted-server.md.
- OpenBot writes provider diagnostics to `logs/providers/providers.log` in its data folder: state changes, CLI checks, start times, model list results and provider errors. OpenBot removes credentials from each line, and does not write environment values, tool output or conversation text to the file.
- The provider settings show the last error of each provider until the provider lists its models again, with a "Copy diagnostics" action.

### Changed

- The comparisons on openbot.run/compare include Cursor CLI and hosted OpenBot servers in the EU,
  Claude Cowork's move to cloud-only tasks on 6 October 2026, and Manus 2.0.
- News, guide and comparison pages on openbot.run load faster: their artwork is WebP and about 3% of its old size.
- Search results show fuller descriptions of the plugin pages and shorter descriptions of the comparison pages on openbot.run.
- "The selected agent model is unavailable." now gives the cause: the provider is not connected, the provider listed no models (with its last error), or the provider does not list that model.

## [0.28.0] - 2026-10-02

### Added

- Your agents can answer in Slack. Open **Server settings → Connectors → Slack**, select **Connect
  Slack** one time and install OpenBot in your workspace. People mention @OpenBot in a channel or
  send it a direct message. OpenBot joins every public channel by itself; a private channel needs
  `/invite @OpenBot`. The connect dialog also
  adds the Slack Orchestrator, an agent on the model you pick, in a collapsed **Integrations** section of
  the sidebar: it receives each request, gives the
  work to the agent that fits best, and posts the answer in the thread. The answer comes in the same thread, can include
  files, and asks the person who wrote for approval with buttons. Reply `stop` to stop a request.
  Slack's events reach this computer through OpenBot's Signal service, which checks them and passes
  them on without storing them, so this needs an OpenBot account and a name for this computer. A
  hosted server stays awake while Slack is connected.
- Brazilian Portuguese for the desktop app and web client. Select Português (Brasil) in Settings, or use your system language.
- More of the desktop app and the web client is in Turkish, including server settings, providers, marketplace, routines, usage and remote desktop.
- Cline is a provider. Its free models have a limit for each model, and the provider of a free model can use your prompts to train models. Select Download on the Cline row in More providers, then sign in with your Cline account in the browser, or set `CLINE_API_KEY`. Cline agents stay on this computer: team members do not see them.
- You can run your own account service, Signal and TURN for remote access. Start the app with `OPENBOT_AUTH_API_URL` and `OPENBOT_REMOTE_SIGNAL_URL`. Invitations for your service are `openbot://join` links. See [Self-hosted remote access](https://github.com/nightly-labs/openbot/blob/main/docs/self-hosting.md). ([#1263](https://github.com/nightly-labs/openbot/issues/1263))
- A Schedule view shows the routines of all agents and channels on a server in a day or week calendar, with past results and planned runs. Open it from the server menu or the command palette.
- Restart a provider from its menu in Settings, and restart all custom agents from the Custom agents section. OpenBot waits until no agent of that provider works, then starts the provider again and reads its version, sign-in state and models again. Agents of other providers continue to work, and messages sent during the wait run after the restart.
- Restart OpenBot when no agent works, from Settings > Updates. New routine runs wait until the restart and run after it. When an update is downloaded, the same action installs it.
- Add sound feedback. When you turn it on, short sounds play across the app: for buttons, switches,
  tabs and menu choices, for dialogs and menus that open and close, for moves between agents,
  channels and servers, and for typing. Other sounds tell you that an action worked or failed,
  that an agent waits for your approval or answer, that a run failed, and that an attachment
  import finished. Choose Warm, Mechanical, Bubbly or Clicky sounds, or Off, in a new step of the
  first setup, or in Settings > Notifications on the desktop app and the web app. Click a choice to
  hear a preview again. It is off by default.

### Changed

- Server settings → Connectors lists GitHub and Slack. Select one to open its page.
- The logo and the greeting blur a little while the Dynamic Island changes size, as much as the move
  is large: one slow step of the width setting barely blurs them, and a large move blurs them in
  full. The logo also gets a little smaller and half closes its eyes, and on a large move rounds its
  corners a little. The greeting gets a little fainter, and when a large move lands it pops softly.
  Both are sharp and at rest again as the island settles. With Reduce motion on, none of this
  happens.
- Each idle greeting is now a small 3D card that moves once as it shows, and then turns back to
  itself: the hand waves, turns into heart hands and back; the smile spins like a ball into a grin
  and back; the raised hands turn to clap twice and turn back raised; and the sparkles light up one
  star at a time and then shimmer. One greeting hands over to the next with a soft blur, fade and
  scale. The greeting is a little larger (16px). With Reduce motion on, the greetings do not move.
- Below 100%, the idle Dynamic Island width now changes with each step of the width setting, from
  the smallest island at 20% to the default at 100%. Before, the lowest steps gave the same island.
  On a built-in display with no notch, the smallest idle island is now 84px, with a 16px gap between
  the logo and the greeting. It was 120px. The same percent can give a different width than before.
  Beside a physical notch, the width does not change.
- The notice about different OpenBot versions on a server now says which side to update: OpenBot on the server, or this app. It offers the host update only when the server is the older side.
- A hosted server now stops about 15 to 30 minutes after your last message, change or typing, also
  when an app is open. Before, an open app that nobody used kept the server running for 1 hour or
  more. While the server is asleep, you can still look at it: a moon beside the server name shows that
  it sleeps. Press a key or click to wake it. Your draft stays.

### Fixed

- A custom ACP agent that is slow to start now shows its models. Model discovery waited only 5 seconds for it. ([#1230](https://github.com/nightly-labs/openbot/issues/1230))
- The **Open OpenBot** button on the page that Slack returns to after you install OpenBot is now in the
  middle of the card.
- A link to a file that an agent edited now opens the file. Before, a link to a file outside the agent's workspace, a link with a line number such as `page.tsx:12`, a `~/` path or a `file://` link showed "not found" or an error. A file outside the workspace opens only for an agent with Full access, and "Open file externally" shows it in the file manager. ([#1240](https://github.com/nightly-labs/openbot/issues/1240))
- A link to a file that was moved or deleted now says so. Before, it told you to ask the agent to create the file.
- A long error after a failed provider update ran out of its notification. Now it stays inside, stops after three lines, and "Show details" shows the full text.
- When the Dynamic Island width or height changes, the logo and the greeting now move with the black
  island, on the same curve and at the same distance from each edge. Before, they got to their new
  place first and showed outside the island while it grew.
- Settings → Dynamic Island → Size: the built-in display preview now draws the island that display
  shows. On a built-in display with no notch, it no longer draws a notch. Each preview scales so
  that the widest width fits its frame, and keeps that scale while the setting changes. The
  preview island hangs below the frame edge, so the edge runs over it.
- A lower Dynamic Island now has smaller bottom corners (7.9px at 75% height, 14px at 100%), and a
  higher one larger corners. On an external display the island stays a capsule at every height. At
  100% height nothing changes.
- With the Cursor provider connected, the model picker showed no models for any provider. Now the
  Cursor models load and you can select them. A model with an id that OpenBot cannot use no longer
  removes the models of all providers.
- When a custom ACP agent is slow to list its models, OpenBot now closes the session that it opened
  to read the list. Before, each slow model list kept one idle agent process open until OpenBot quit.
- When OpenBot stops an ACP agent (because it is idle, to restart it, or at quit), the errors that
  the agent writes while it stops go to the log. Before, OpenBot showed each of them as a "Provider
  error" message. When an agent stops on its own, OpenBot still shows its errors.
- A provider CLI download no longer fails with "another instance is replacing it" when no other OpenBot runs. When another program holds the new files open, OpenBot now waits for a moment, and then tells you to close that program. ([#1264](https://github.com/nightly-labs/openbot/issues/1264))
- A failed update notification now closes when the CLI is updated later. Retry on a provider row now removes the old error text, and the custom provider row no longer shows a second Retry next to Add. ([#1264](https://github.com/nightly-labs/openbot/issues/1264))
- On a busy computer, a provider CLI that answers slowly no longer shows as broken. OpenBot now waits 10 seconds for its version, says that it did not answer in time, keeps the last known version, and tries again by itself. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
- A provider refresh no longer marks a connected provider as failed while its models stay in the model list. ([#1258](https://github.com/nightly-labs/openbot/issues/1258))
- A desktop chat no longer shows an empty bubble when an agent ends its turn without an answer, for
  example after it reads a teammate update that needs no reply. The phone app and channels already
  hid these rows.
- Keep OpenCode's free model picker available when a temporary model-discovery failure occurs.
- On Windows, an agent that starts from a `.cmd` or `.bat` file now gets each argument as written.
  Before, the command processor split or changed an argument with a space, a quote, `&` or `%`.
- An agent request that failed no longer shows an `Error handling request {` toast, and the lines under it no longer show as more toasts. The failure shows in the chat with the reason that the agent gave, and the full text goes to the log.
- Gemini no longer fails with "Download failed" when its first start after the download is slow. OpenBot now waits up to 3 minutes for a CLI that it just installed to start, and onboarding shows why a download or that first start failed.
- When more than one provider updated at the same time, the update notifications jumped and
  overlapped. Now they stay in place while the downloads continue.
- On Windows, a provider CLI install (for example OpenCode or Gemini) no longer fails with "another program has its files open" while Windows Defender scans the new files. OpenBot now waits up to 60 seconds for the scan to end.
- A custom agent kept its saved model after a restart. Before, a custom agent that started slowly could move its agents to its default model.
- The Usage panel shows the remaining Grok usage. Before, a Grok account with no use in the current period showed a dash in place of a percentage.
- A provider row in the Usage panel shows "Loading…" while usage loads, and "Unavailable" with "No limit reported" when the provider reports no limit. Before, both showed a dash.
- A Claude Code agent no longer shows a `<task-notification>` block as a message from you after
  OpenBot restarts. These blocks are notices about background tasks. Notices that earlier versions
  added are removed the next time OpenBot starts.

## [0.27.0] - 2026-10-01

### Added

- Turkish (`tr`) language support across desktop, web, and shared packages.
- Cursor is a provider. Select Download on the Cursor row in More providers, then sign in with your Cursor account in the browser, or set `CURSOR_API_KEY`. OpenBot uses a `cursor-agent` that you installed yourself until a download exists. Cursor agents stay on this computer: team members do not see them.
- Settings → General → Appearance has a Logo color setting with 10 colors. The chosen color shows on
  the Dock or taskbar icon, on the Dynamic Island and on the logos in the app. When OpenBot is
  closed, the Dock shows the lavender icon, because macOS has no alternate app icon for desktop apps.
  A dev or preview build keeps the color of its build.
- Global search (⌘K) finds channels, files, routines, commands and settings pages. New filters show Channels, Files and Routines. Select a file to show the message that has it. Select a routine to open its settings. Commands such as New agent and New channel, and each settings page, show in All when the query matches. Files come only from this computer, so a joined server and the web client do not show the Files filter.

### Changed

- The GitHub page in Server settings > Connectors has a new design. It shows the GitHub status and
  your account picture. A dialog guides you through the sign-in code. You can filter the list of
  repositories. Disconnect asks you to confirm first.
- When an account has the maximum number of paid hosted servers, the add server dialog now tells the user before they choose a plan. The plans are disabled, and a "Manage servers" button opens the list of hosted servers, where the user can delete one.
- Hosted sites now belong to the server that published them. Each server has its own limit of active
  sites from its plan: 1 with no plan, 3 on Starter, 10 on Standard and 50 on Pro. Uploads from a
  computer that is not a registered server share one site for each account.
- Manage sites in Server settings > Sites, on the desktop and in the browser. All members see the
  list. Only an owner or admin can delete a site. The Hosted sites tab in Settings is removed.
- After a downgrade, sites above the new limit stay until they expire. The server cannot publish a
  new site until it is below the limit, but it can update an existing site.
- Manage AI providers in Server settings > Providers, not in Settings. Each server shows its own
  providers. For a server that is not active, the section offers to switch to it.
- Global search (⌘K) has a new, more compact design. Each result uses one line, and All shows each kind of result in a separate group. The query text is highlighted in the results. The filters are in the search field, and Tab and Shift+Tab change the filter. A footer shows the keyboard shortcuts, and a spinner shows when results are slow to load. The search opens, closes and changes height with a short animation, the results fade at an edge that has more to scroll, and the highlight and the filter pill slide to the new row or filter. Long result lists scroll smoothly with the arrow keys and stay fast with thousands of results. The Messages and Files filters load more results as you scroll to the end.
- The Marketplace is now one full-screen window with the tabs Agents, Apps and Skills, a search field and a filter menu. Each agent, app and skill has its own page.
- You can install a skill on all your agents in one step. The Marketplace names the agents where the install failed.
- When you add an agent, the Marketplace stays open. The button then says "Open chat".
- The GitHub page in the Marketplace and Server settings › Connectors show the same GitHub connection.

### Removed

- The Cursor preset for custom ACP agents. Use the Cursor provider. A custom agent that you saved with the preset continues to work. If its ID is `cursor`, you cannot edit it: to change it, remove it and add it again with another ID.
- The GitHub plugin that used a personal access token. Use the GitHub connector. A server that the plugin added stays, and shows as a custom server. Remove that server, so that your agents use the GitHub connector.
- Skill and agent publishing from the desktop Marketplace.

### Fixed

- Search now finds a phrase that a line break splits in a message, in the chat and in global search. The chat search also highlights it. Thanks to @aniruddhaadak80 for the first fix in #1174.
- With Grok, an MCP server from `~/.claude.json`, `~/.cursor/mcp.json` or `.mcp.json` that needs
  an OAuth sign-in no longer shows a "Provider error". Before, Grok's `worker quit with fatal …
  AuthRequired` line showed as an error, but the chat worked without that server.
- An agent that another agent creates now gets the provider, model, and reasoning effort of that agent, unless the request names different ones. Before, each new teammate started on the default model. ([#1201](https://github.com/nightly-labs/openbot/issues/1201))
- Keep the other devices connected to a desktop when one phone reconnects. Before, a late network
  message from the old connection of that phone could disconnect every device from the desktop.
- Keep the web client connected through a short network change. Before, it made a new connection
  after 5 seconds without an ICE restart, and it retried only every 10 seconds.
- The startup screen now shows the full logo animation before it fades. Before, on a fast start, the logo flashed half drawn and was gone.
- A cancelled or unfinished Stripe payment no longer blocks a new hosted server. A new plan choice now changes the plan of the server that waits for its first payment, and does not add a second server.
- Start the Claude and Codex CLIs on Windows when the user name holds a space, such as
  `C:\Users\Jane Doe`. Before, the Claude sign-in check failed with "'C:\Users\Jane' is not
  recognized as an internal or external command".
- Pressing Enter to confirm Japanese, Chinese, or Korean input in the custom answer field of an
  agent question no longer sends the answer. Before, the answer was sent with the unconfirmed text.
- Keep the last successful OpenCode model list when a later catalogue refresh fails. This keeps a connected provider's model picker usable after a temporary ACP timeout (#508).
- Notifications that arrive together merge into one stack, and hover shows all of them with no empty space. Up to six update notifications show, not three.

## [0.26.0] - 2026-09-30

### Added

- In an agent chat on a team, each message from another person stands on the right, with your messages, and shows their name. Their bubble has their own color, so it does not look like yours. Agent messages look the same as before. Messages sent before this update show as yours.
- A hosted server updates itself. It downloads a new OpenBot release in the background and starts it at its next start, so an open session does not stop.
  A server that was set up before this release has no updater, so it stays on its current version.
  **Upgrade such a server one time by hand, as `docs/hosted-servers.md` says.** The data in its home
  folder and in `/srv` stays.

### Changed

- A routine run in an agent chat shows as one short line with the routine name and its state. The
  chat no longer shows the routine instruction as your message. Open the routine to read its
  instruction. Chat search no longer finds routine instructions.
- When a hosted server is low on memory, new messages wait in the queue and start when memory is free. The agent shows a notice, and the browser opens no new tab.
- A hosted server runs at most 4, 8 or 16 agent turns at the same time, from the memory of its plan. Other messages wait in the queue, and a message from a person starts before routine runs and teammate messages.
- A plan change no longer stops a hosted server that is in use. The server moves to the machine of the new plan when it has no use for 7 minutes, or at its next start.
- An agent's browser tab that nobody uses for 30 minutes now unloads its page to free memory. The
  tab stays open with its URL, title and preview, and the page loads again when the agent or you use
  the tab. On a server that is low on memory, this occurs after 5 minutes.

### Fixed

- In the browser live view of a remote server, Enter submits a form and breaks a line, and Backspace, Delete, Tab and the arrow keys work.
- With OpenCode, a Computer Use window read adds much less text to the conversation, so long
  Computer Use sessions stay faster and compact less often. Before, each read of a large window
  added a list of element tokens about three quarters of the size of the window tree.
- The Computer Use driver stops when OpenBot stops, also after a crash or an out-of-memory kill. Before, the driver kept running and used memory until you logged out. At the next start, OpenBot also stops the driver that the last crashed run left running.
- OpenBot uses less memory in long sessions. It no longer keeps a second copy of each conversation, and it releases the data of each finished turn.
- The picture-in-picture browser controls release their memory when the system closes the window.
- Antigravity and custom ACP agents stay stopped when they are idle. Before, the usage display started them again every five minutes, and a custom agent router then started the process of each custom agent.
- On a new hosted server, OpenBot keeps running when the server is out of memory. Before, the system could stop OpenBot, or stop all of OpenBot when one agent process used too much memory. Now an agent process stops first.
- The Dynamic Island shows new messages again when you have more than 10,000 unread replies. Before, it stopped updating, and OpenBot logged an error each time the island changed.
- Each Dynamic Island window uses about half the memory. Before, each window loaded the full app. There is one window for each display.
- OpenBot keeps at most 16 chats in memory that you only read. Before, each chat that you marked read stayed in memory until you quit, about 1 MB for a long chat.
- On a hosted server that is out of memory, the kernel now stops an agent process before the processes that OpenBot uses to open browser tabs.
- Sending a message, or a change to a queued message, no longer writes all message history to the
  database again. Before, each change wrote every message and delivery, so on a server that ran for
  weeks each change became slower and used more disk.
- OpenBot stops Codex, OpenCode, Grok or a custom agent when it sends one message larger than 128 MB, and shows the reason. Before, OpenBot kept all of the message in memory with no limit, and the system could stop OpenBot on a hosted server.
- OpenBot uses less memory when it runs for a long time with many agents. When an agent chat is not used for 10 minutes, OpenBot removes its copy from memory and reads it again from the database when you or the agent use the chat. The chat does not change.
- A hosted server uses much less memory when a teammate or a remote device downloads or uploads a file. Before, one 100 MB file could use about 200 MB of memory for the full transfer. Now the server sends and receives files from disk. A server receives two attachment uploads at the same time. Other uploads wait for their turn; they do not fail.
- With Codex (GPT models), an agent now gets the tools of an MCP server whose name has a space or
  another character that is not a letter, a digit, `_` or `-`, such as "Home Assistant". Before, the
  connection test passed but the agent got none of the server's tools.
- `channel_forget_memory` now matches the saved memory text regardless of letter case. Before this
  fix, forgetting a channel memory with different casing than the saved text (for example asking to
  forget "use bun for scripts" when the saved text was "Use Bun for scripts") silently failed and
  left the memory in place.
- When the live view of a remote host's page ends or fails, the panel now shows the message in the
  language you selected. Before, it always showed the message in English.
- With automatic downloads on, one restart now installs the newest OpenBot version. Before, OpenBot stopped checking for updates
  after a download finished. If a newer version shipped before the restart, OpenBot installed the
  older download and offered one more update after the restart.

## [0.25.2] - 2026-09-29

### Added

- Every member of a joined server can import agents from Grok Bot, not only the owner of the computer.
  Open **Server settings → Import** on a joined server in the desktop app or the browser client. The
  export must be a .zip under 100 MB. When the server already has a skill of the export, the agent of a
  member uses that skill and the import says so.
- The host keeps the Lock Screen activity of a joined iPhone current while iOS stops the OpenBot app
  in the background. It encrypts each update for that phone before it goes through the OpenBot
  account service and Apple, so neither can read it. The host keeps the phone's push token in memory
  only, for the session that gave it.
- Enter a promotion code on the payment page when you start a plan for a hosted server.
- Connect an AI provider before you make the first agent on a server that you own or manage. Before,
  a new server opened on the agent form with no provider connected.
- Sign a server in to Claude and Grok from your own device, when the server has no browser that you
  can see, such as a hosted server. Claude shows a code on its page that you paste into OpenBot.
- Connect GitHub in Server settings > Connectors. Every agent on this computer then gets the GitHub
  tools, and `gh` and `git` sign in as you, in the repositories where you install the OpenBot GitHub
  App. The panel lists these repositories. You do not need a personal access token.
- In the repositories where you can push, GitHub shows the issues, pull requests and comments that
  an agent makes with the GitHub tools as `openbotgit[bot]`, not as you. OpenBot gets short-lived tokens for this from
  the OpenBot account service, which keeps no token. `gh` still acts as you.
- Use remote desktop on a Linux x64 host in an X11 session, including a hosted server. Wayland is not supported.
- On a hosted server, remote desktop shows the full server desktop with its window manager, so a click moves between windows.

### Changed

- In a dev or preview build, the OpenBot logo on the Dynamic Island has the color of that build, as
  the Dock icon does. Two OpenBot apps that are open at the same time are easier to tell apart.
- Show a new loading screen in the browser app: a small crew of agents hops while OpenBot loads,
  and jumps out when it is ready.
- Show the OpenBot logo while the desktop app starts, and fade it out when the app is ready.
- Show how long the agent's activity line has stayed the same when it stays for more than 5 seconds,
  so a slow step no longer looks like a stopped agent.
- Show "Using an app on this computer…" while a Computer Use action runs, and "Deciding the next
  step in the app…" while the model chooses the next one. Before, both showed a general tool text.
- Tell agents to go directly to the named application and action with Computer Use, without
  listing other applications or reading the same window again.
- Log the time that the Computer Use driver takes to answer each call, and each call that gets no
  answer, so a slow step shows whether the driver or the model used the time.

### Fixed

- The logo color of a dev or preview build matches its app icon. Before, the logo in the app was
  orange or bright green, and the app icon was gold or soft green.
- A Grok agent answers again after you sign in to Grok with a different account or change the xAI
  API key. Before, each message in an earlier chat failed with "reasoning `encrypted_content` was
  not issued to this caller". Now OpenBot starts a new Grok session that keeps the chat history, and
  sends your message again.
- On Windows at a display scale other than 100%, the Computer Use border goes around the full
  window. Before, only the top and left edges were on the screen.
- The Computer Use border stays on the window while the agent thinks between two steps, and goes
  away when the turn ends, fails, or is cancelled.
- When an OpenCode model request fails, the error tells why: a rate limit, a billing problem with
  the provider account, a failure on the provider's side, or no network connection. Each error
  tells you what to do, and whether waiting helps. Before, every cause showed as
  "Internal error:" followed by the provider's text (#1163).

## [0.25.1] - 2026-09-29

### Added

- Publish an agent from the browser client. An owner or admin of a server can publish, update or
  unpublish the share link of an agent on that server from the conversation header. The template
  belongs to the account signed in on the host, and the host must run this version or later.
- Open Account settings from the account menu in the web app. It has your profile, your hosted
  sites (open or delete them), and preferences for the language and the completion sound.

### Fixed

- Save the "Play a sound when a task finishes" setting in the desktop app. Before, the sound played
  when the setting showed off, and the setting did not stay after a restart.

## [0.25.0] - 2026-09-29

### Added

- Update OpenBot on a joined server from Server settings > Updates. Owners and admins can check for
  an update, download it, and restart the host when its agents are idle, or restart it at once.
  The version notice for a server has an "Update host" button.
- Turn off updates from server admins in Settings > Updates on the computer that runs the server.
  That computer shows who asked for an update and can cancel the restart.
- Turn on automatic download and automatic install when idle for a joined server in Server
  settings > Updates.
- A notice shows the download percentage while a server updates, and tells admins when a server
  has a new version.
- All members of a server see a notice before and while it restarts into an update. OpenBot
  connects again when the server is back.
- Chat messages show LaTeX math as typeset formulas. Write inline math as `$...$` or `\(...\)`, and
  display math as `$$...$$`, `\[...\]` or a `math` code block. A formula that does not parse shows
  its source. Copying a formula gives its LaTeX source. Before, the formula showed as raw source
  with its dollar signs and backslashes.
- The page of a shared agent has an "open in browser" link below the card, next to "Download it" and
  "open the app". It adds the agent from the browser client when you do not have the desktop app.
- The sidebar shows agents that wait for you in a "Needs you" group at the top, with a count. Each row shows what the agent waits for, "Answer", "Review" or "Take over", and a tooltip shows the question or the command. The agent goes back to its section when you reply.
- The message box continues a Markdown list. Press Shift+Enter after a `- `, `* ` or `1. ` item to start the next item. Press Shift+Enter on an empty item to end the list.
- Your own messages show Markdown, such as lists, bold text and code, as on the iPhone app.
- Show browser notifications in the web app when an agent finishes, stops with an error, or needs
  your input or approval, on every connected server. The web app shows them while its tab is open
  and does not have focus.
- Mute a server and set its notification level in the web app, from the server menu or Server
  settings. This browser keeps the choice.
- Explain how to use the OpenBot Marketplace to install agents, plugins, and skills, and submit an agent for review.
- Add "New agent" and "Mark all as read" to the sidebar menu that opens when you right-click an empty
  part of the sidebar, on the desktop app and in the browser client. "Mark all as read" marks all
  agent chats and channels as read.
- Add a hosted server with the plus button in the server rail. Choose a plan and pay on the Stripe
  page. OpenBot sets up the server when Stripe confirms the payment, and connects to it. Each hosted
  server is a Linux machine.
- Manage the plans of your servers. Desktop Settings has a Billing tab, and the web app has Billing in
  the account menu. It shows the plan, the storage, the price and the renewal date of each server
  that your account pays for, and a warning when a payment failed.
- Each server has a menu to change or cancel its plan, or to renew a plan that ends. Payment method
  and invoices opens the Stripe Customer Portal. You enter card details on the Stripe page, not in
  OpenBot.
- The plan of a server sets its member limit: Starter 3, Standard 10 and Pro 25 active members,
  owner included. A server with no plan keeps 3. When a plan goes down or ends, no member is
  removed, but no new member can join until there is a free seat.
- A hosted server stops 15 to 20 minutes after its last use and keeps its data. It starts again when you
  connect to it, and a few minutes before its next scheduled routine. An open app that sends no
  request or message for 1 hour does not keep the server on.

### Changed

- Product analytics records which tools, catalog plugins, websites and routines the agents use, so we
  can learn which tasks OpenBot is used for. A website is sent only as its registrable domain, such
  as `linkedin.com`, never as a URL, path or page title. IP addresses and names with no public
  suffix, such as `.local` hosts, are not sent. The name, address and command of a server that you
  added are not sent. Once a day, the app also sends counts of your agents, routines, skills and
  servers, and the names of the catalog plugins and curated listings that you use. You can turn off
  product analytics in **Settings → General → Privacy**. See `PRIVACY.md`.
- The browser client shows the account, usage and settings controls at the bottom of the sidebar, as
  the desktop app does. Before, usage and settings were only in the account menu.
- The account service sends product analytics events when a plan or a hosted server changes. The
  events have your account ID and fixed values only, with no email, name or server ID. See
  PRIVACY.md.

### Fixed

- A routine runs one time after the computer wakes from sleep. Before, each time missed during
  sleep started its own run, one after another, and the first run often failed because the network
  was not back yet. Routines now wait for the network after a wake, and an agent routine does not
  add a new scheduled run while its previous run is still in the queue.
- Close search with Escape or a click outside the search panel. Before, only Command K or a result
  closed it.
- Keep the search tabs in the same place when the result list changes height. Before, one click on
  a tab could also open the agent that moved under the pointer.
- In the desktop app, the live view of a remote host's browser now ends cleanly when the host sends a frame that it cannot show. Before, this caused a main-process error, and the live view did not stop.
- The live view of a remote host's browser now ends when its connection closes abnormally. Before, the view could stay open with no new frames, and on the host the end of a live view could also stop a remote desktop session that was running at the same time.
- The desktop app now releases the host's live view session when it cannot open the view. Before, the session stayed open on the host and counted against its limit.
- The chat scrolls with the mouse wheel or trackpad when the pointer is on a code block. Before, the
  chat did not scroll until the pointer left the block.
- In "Providers & permissions", the "Try it free" arrow points at the OpenCode row. Before, its
  position came from the screen layout, so it could point at a different row. The arrows of
  "Try it free" and "Not in the list?" now point at the middle of their targets on both setup
  screens.
- Install updates on Linux again. Before, OpenBot always refused the install with "Another OpenBot
  session is still running from this application", also when only one session was open.
- OpenCode agents no longer stop with "Internal error: OpenCode service failure" after a reconnect
  or a restart. OpenCode sends this error when it cannot find a stored session. OpenBot now reads
  OpenCode's session list. If the list does not hold the session, OpenBot starts a new OpenCode
  session with the conversation history. In all other cases OpenBot keeps the session, tries one
  more time, and then tells you to try again or reconnect OpenCode.
- Start the server list at the top of the web app. Before, the web app kept the empty space that
  the desktop app keeps for the window controls.
- In the agent avatar editor, the "Generated face" heading stays on one line. "Reset to ID" and "New
  set" are now icon buttons with a tooltip. Before, the heading went onto two lines.
- Play the completion sound in Safari in the web app. The sound now also follows the server's mute
  and notification level.
- Remote control connects at once to a computer or server that restarted with no clean
  disconnect. Before, it waited until the old connection timed out.

## [0.24.0] - 2026-09-28

### Added

- Ask an agent to set up another agent after it creates it. The agent can read another agent's
  profile, model, settings, skills, routines and MCP servers. It can install, turn off and remove
  local skills for another agent. It can set another agent to Workspace only, turn Computer Use off
  and change notifications. Only you can give Full access, turn Computer Use on, change auto-approve
  or change MCP servers. A new agent gets the access limits of the agent that creates it.
- Ask an agent to change the provider, model or reasoning effort of another agent, as it can
  change a name. The agent gets an error that names the available models when a model is not
  available. OpenBot records which agent made the change, and the previous and new model.
- Find local model servers, such as Ollama and LM Studio, and known ACP agents on your computer.
  Settings shows them under "Found on this computer", where you can add or hide each one. First run
  shows the same list. The scan sends no key and does not start a program that it finds. You can
  turn it off, or add more addresses and folders, in Settings.
- Add a custom ACP agent, such as Goose, Qwen Code, Cursor or GitHub Copilot CLI, as a provider.
  "Check agent" starts the command once to make sure that it answers. Its environment variables
  are stored encrypted on your computer.
- Edit a saved custom endpoint. An empty key field keeps the saved key. "Find again" loads the
  model list from the server.
- Leave a joined server from its Server settings. OpenBot asks you to confirm, then removes the
  server from your server list. The server and its other members stay. To join again, you need a
  new invitation.
- The iPhone app is in public beta on TestFlight. A card at the bottom of the sidebar shows the
  install steps and a QR code of the invite link. You can close the card. Settings > Mobile Connect
  always shows the same steps, the QR code and a button that copies the link.
- Add Paper to the Plugins tab. Agents can read and change the file that is open in Paper Desktop.
  Install Paper Desktop, open it once, and open a file. Paper needs no key. The command of a local
  MCP server can now start with `~/`, which is your home folder.
- Search is available on mobile. It finds agents and the messages in their chats on the connected computer.
- Resize the sidebar in OpenBot web, and drag it narrow to make it compact. A narrow browser window
  makes the sidebar compact by itself, as in the desktop app.
- Open the usage report of a host from its menu in the OpenBot web server rail.
- Press Cmd+K or Ctrl+K in OpenBot web to search all conversations on the host.
- The "Waiting for replies" block now has a close button when every teammate has replied or failed. Before, a failed request kept the block above the message box until you sent a new message.
- Open the server menu from the server name in the web client. The menu switches and adds servers,
  opens server settings and the marketplace, and sets the rail or menu layout, as in the desktop app.
- Show the "Create your first agent" row in the web client sidebar when a server has no agents.
- In the web app, change your display name and profile photo and disconnect account sessions. Open
  **Profile** from the account menu; it opens in the right panel of the agent on screen.
- The web account menu now has usage, Settings (the host's settings), Marketplace, Send feedback, and
  Message, as in the desktop app. Before, it had only Sign out.
- Open an invitation link in OpenBot web. The invitation page has an Open in browser button, and the
  web client opens the join dialog with the link filled in.
- Open a plugin listing in OpenBot web. The plugin page has an Open in browser button, and the web
  client opens the marketplace on that listing.
- "New chat" in the agent settings starts a new chat with the agent. The agent forgets the earlier chat. The earlier messages stay visible above a divider. The instructions, model, tools, memories, workspace, and browser do not change. It is available on desktop and in the web client, also for an agent on a joined server that is on this version or later.
- OpenBot now has a macOS build for Intel Macs: download `OpenBot-<version>-x64.dmg` from the release. It includes the provider runtimes, Computer Use, voice input and remote desktop hosting. Intel Macs get updates for the Intel build, and Apple silicon Macs continue to get the ARM64 build. The Host package (PKG) is still for Apple silicon only.
- The web client sidebar has channels, as in the desktop app. You can create, edit and delete a
  channel, open deleted channels, and use channel memories and routines. The "+" menu and the
  sidebar context menu have New channel.

### Changed

- The iPhone app shows an agent plan as a task list, as desktop does: a card that opens and closes,
  with the state of each step and a spinner on the step that runs. The last message of a chat and
  its read state do not include plans. Team API v4 now sends the plan of a turn beside its
  checklist text; older clients and hosts keep reading the text.
- The iPhone app shows a file name in inline code, such as `package.json`, as desktop does: a type
  badge and the name in the colour of its file type. You cannot open the file from the phone yet.
- On the iPhone app, the question form of an agent has no text field of its own. It shows "Reply
  in the chat" as one more answer row. Tap it, and the next message from the composer is the
  answer. Without that tap, the composer sends normal messages, also in a channel. A private
  answer still uses its own masked field.
- On the phone, an answer from a teammate agent no longer shows as a queued message that you can
  edit, steer or move. The queue sheet shows it under "Waiting for replies". A computer on an older
  version does not send this information, so its answers still show as queued messages.
- Show a "Connect your computer" screen in the web app when no computer is connected. It gives the
  three setup steps and the Download, Join with invitation and Refresh hosts buttons. Before, a
  small notice showed above an empty conversation. When the computers cannot load, an error message
  now shows at the bottom of the screen.
- Show a centered screen with the same design when your computer is disconnected or connecting. It
  gives the reason and a Reconnect button. Before, a small notice showed above the conversation.
- The web app and a joined computer now show Gemini and custom ACP agents from the host in the
  model picker, and can start agents on them. An owner or admin can download Gemini on the host.
  The host and the client must both have this version.
- The web model picker shows the host's download progress, the Download and Cancel buttons, and
  the host's custom endpoints on the Custom tab, for an owner or admin.
  Your draft stays when you reconnect.
- Show the OpenBot logo and an animated loading bar on the sign-in background while the web app
  loads. Before, the page showed only the text "Loading OpenBot…".
- Ask before an import adds an agent whose name is already on the server, for example when you
  import the same export again. The dialog names the agents and says that each copy is a separate
  agent. Before, only an info icon next to the name showed this.
- Mobile search shows one list of agents and messages, with no filter, in a rounded search field.
- The search and add buttons on the mobile home screen are two separate buttons.
- The mobile search sheet uses the same background and header fade as the other sheets.
- In "Waiting for replies", the avatar of a working teammate no longer moves. The spinner at the end of the row shows that it works.
- Agents ask a teammate, or try their connected plugins, the browser and Computer Use, before they
  say that they cannot do a task. When a site needs a sign-in, the agent asks you to sign in in the
  browser instead of stopping. When a teammate helps, the answer starts with its name. When nothing
  works, the agent says what it tried and what you can do to unblock it, such as installing a plugin.
- You can make the Dynamic Island as narrow as 20% of its default width. Before, the smallest width was 70%.
- The OpenBot logo and the greeting in the idle Dynamic Island keep a 16px inset from the edges. Only
  the space between them changes with the width.
- The web client now opens the first-agent form when a computer has no agents, with the same text
  as the desktop app and no Cancel button. The model of a new agent is the same default that the
  desktop app selects.
- A host can now have up to 3 active members: the owner and 2 other people. A new join or a
  reactivation that goes over this limit fails with an error. A host that already has more members
  keeps all of them. Removed and disabled members do not count.
- Server members on desktop and mobile shows how many members the server has of its limit, for
  example "1 of 3 members". When the server is full, you cannot create an invitation until you
  remove a member.

### Fixed

- The web app no longer shows the agent's working notes as chat bubbles. Before, each step of a
  turn showed as its own bubble, and some of these bubbles were empty. The web app now shows the
  same messages as the desktop app.
- Stop "Provider error" messages for Antigravity info and warning log lines, such as "Checkpoint
  summary was too long". Before, one message showed at each step of a long conversation. These
  lines now go to the log. Antigravity error lines still show.
- When Codex ignores an unknown setting in its configuration, show one warning that names each
  setting. Before, a "Provider error" showed only "Codex is ignoring 1 unrecognized configuration
  setting", with no setting name, and it came back after each reconnect. Codex continues to work.
- Create one routine when you ask an agent to make a new agent with a schedule. Before, both agents
  could save the same routine. An agent can no longer add a routine with the name of an existing
  one; it changes that routine instead.
- Start a new agent on the model that you saved in setup, also when that model is a ChatGPT model.
  Before, the agent stayed on GPT-6 Luna. Agents from a template, the marketplace or an imported
  file now also start on the provider and model that you saved in setup. Before, they always
  started on ChatGPT. When you saved no model, a new agent starts on GPT-6 Luna, and on GPT-6 Luna
  in the web app too. Existing agents keep their model.
- Show the highlight of the selected server across the full row in the mobile server list. Before,
  the highlight stopped at the end of the server name.
- Keep the reason when an agent turn fails. The queue now shows the provider error after the banner
  closes and after a restart. Before, a failed message kept no reason.
- Do not ask a joined server for its MCP server list when you are a member without the admin role.
  Before, each visit logged a refused request.
- Show the loading placeholder in a browser tab preview while the page loads. Before, the preview
  could show a failure icon until the next capture.
- Reload the web app one time when an update removed the files that it needs. Before, the first
  open after an update could show "This page could not load".
- Import an agent when one of its files is already in the workspace, for example two files whose
  names differ only in case on macOS. The import keeps both files, saves the second one as
  `name (2).ext`, and shows a warning. A file that it cannot write is skipped with a warning. Before,
  the agent was not imported.
- Connect the Figma plugin to the MCP server in the Figma desktop app on your computer. Before, the
  connect step always failed, because Figma does not accept a browser sign-in from OpenBot. The
  connect dialog shows the steps that turn on the server in Figma. The server can only read designs
  for now.
- If you installed the Figma plugin before this version, Plugins shows it as not installed.
  **Remove the old `figma` server from the MCP servers of the agent, then install Figma again from
  Plugins.**
- On Linux, the window no longer closes a short time after it opens on some GPU drivers. OpenBot now uses software rendering on Linux.
- A finished agent reply no longer shows the text of another message after the chat scrolls or loads more messages.
- Phones and other devices connect to your computer again when its network comes back. Before, the
  computer stayed offline for them after Wi‑Fi was off, until you restarted OpenBot.
- Show an error and a Retry button on the web sign-in screen when the session check fails. Before,
  the screen showed the email form with no error.
- Stop the web sign-out from staying on "Signing out…" when sign-out fails. The account menu now
  shows the error, and you can try again.
- Show a web session-check error as a notification. Before, the message pushed the dock and the
  composer out of the window.
- Use the plain sign-in background on the web, the same as the desktop app.
- Mobile search no longer shows sample English results that did not come from your computer.
- Mobile chat previews and search results show message text without Markdown marks such as `**`.
- A tap anywhere on the mobile search field opens the keyboard. Before, a tap near the edge did nothing.
- A chat opened from mobile search closes with the same zoom into its row as a chat opened from the list.
- Show the full compatibility screen in OpenBot web when a host cannot talk to this version. Before,
  the web showed "Your computer is disconnected".
- Keep the server rail of OpenBot web as wide as in the desktop app. Before, it was 8 px narrower, so
  the sidebar and the chat moved.
- Keep the message that you pick in global search on screen. Before, a conversation that loaded at
  the same time could scroll to the latest message.
- In the web client, files that you drop on a chat or channel, or paste into its message box, now attach to the message. Before, the web client ignored them.
- In the browser, a shared or workspace file link in a message opens the file preview. Before, it
  showed a "desktop only" error.
- In the browser, a sent image no longer shows "File not found". Its card shows the name and size,
  and a click opens the preview.
- In the browser, "Open" on a file card opens the preview. Before, "Open" and "Download" both
  downloaded the file.
- In the browser, an image in the composer shows as a file with its name instead of a broken
  thumbnail.
- In the web client, a chat with an agent now shows the unread divider and the new messages banner, and marks messages read on the host. Before, the web client did not show unread messages and did not mark them read.
- The web account dock shows your name and email on every browser. Before, it used the macOS
  layout on every computer.
- The web usage indicator reads usage again when a provider connects or disconnects on the host.
- A channel now shows a stop button while its agents work. Before, you could not stop a channel run.
- On a MacBook with no notch, the Dynamic Island gets narrower when you make its width smaller. Before,
  it kept an empty space for a notch that was not there, and the width setting had almost no effect.
- A narrow Dynamic Island no longer cuts off the greeting at its right edge.
- Pause the browser view in OpenBot web while the marketplace or a notification covers it, as the
  desktop app does.
- The web client now shows the queued messages of an agent. You can steer, cancel, reorder, and edit them, as on desktop. The "Waiting for replies" count on the web now agrees with desktop.
- Keep the server order that you drag in the web client's server rail. Before, the rail said the
  server moved, but the order did not change.
- Show the real connection state of each server in the web client. Before, every server that was
  not open showed as offline.
- Show server logos in the web client's server rail, server menu and server settings.
- The browser preview no longer waits behind the agent's browser actions. While the agent works on a
  tab, or when a capture is slow, the preview shows the last frame of the same page. Before, a
  preview on a heavy web app could take up to 30 seconds, and it also delayed the agent's next
  action.
- Browser snapshots are smaller. The page text is limited to 20,000 characters, with the text in
  the viewport first, and the snapshot says when it left text or elements out. Each snapshot also
  shows fewer and shorter console and action entries. Before, each browser action could add up to
  1 MB of page text and log entries to the agent's context.
- On Linux and macOS, OpenBot finds a provider CLI that you installed yourself, such as OpenCode under
  nvm, when your shell profile prints text at start. Before, a greeting or a tool such as `fastfetch`
  in `.bashrc` or `.zshrc` made OpenBot show the provider as not downloaded. MCP server commands had
  the same fault.
- The web client now sets the page language to the language of its text. Before, the page always
  said English, and a screen reader could read other languages with an English voice.
- While the web client loads, it shows the OpenBot loading screen from the first frame. Before, the
  first frame was an empty page.
- The web client no longer uses the smooth scroll and the minimum page width of the site pages.
- A left-click now closes a sidebar context menu. Before, the menu stayed open when you clicked the
  empty sidebar area or the row that opened it.
- The `$` menu in the web client shows the agent's skills, and MCP servers for an owner or admin.
  Skill tags in messages show as skill chips, and copied messages use the current skill names.
  Before, the menu was always empty and each skill tag showed as an unavailable skill.
- The web client keeps pinned agents and channels, and collapsed sections, after a reload. Before,
  it forgot them, and only agents could be pinned.
- The fullscreen browser in the web client has back, forward, reload, the address field and tab
  close, as in the desktop app. Before, its toolbar was empty.
- The web browser sidebar shows tab previews. Before, the cards had no preview.
- A new tab in the fullscreen web browser no longer fails with "The host could not complete this
  request".
- In the web app, a reply streams into the chat as it arrives. Before, the app read the whole
  conversation again for each part of the reply.
- In the web app, the activity line shows what the agent is doing now, as in the desktop app.
- In the web app, an agent error shows its own text above the composer, as in the desktop app.
  Before, a general "The host reported an error" message replaced it.
- In the web app, a message that fails to send shows its error one time, above the composer. Before,
  the same error also showed as a notification.
- The web app shows the usage-limit notice above the message box when the selected model has no usage
  left. Before, only the account menu showed the usage.
- In the web app, a reply to an older message shows the quote of that message. Before, the quote was
  missing until you loaded the older messages.
- In the web app, a question card stays open until it has shown your answers. Before, it could close
  before the answers appeared.
- The web app plays the completion sound when an agent with notifications on finishes a task, as the
  desktop app does.
- The web app tells the host when you are writing to an agent, as the desktop app does.

## [0.23.0] - 2026-09-27

### Added

- Show the plan of an agent as a task list in the chat. The list changes while the agent works and
  stays in the history. Codex, Claude, OpenCode and Grok agents send plans. On mobile, the plan
  shows as a text checklist.
- Show a "Waiting for replies" block above the message box when an agent asks its teammates. Each
  row shows a teammate and its status: asked, working, replied or failed.
- Let an agent see the progress of other agents, and stop work that it gave to another agent. An
  agent can stop only a turn that its own messages started. It cannot stop work from you, a
  routine, a channel or another agent.
- Let an agent create a new agent with the provider, model and reasoning effort that you ask for.
  An agent can also read the models and reasoning efforts of each provider.
- Show the images of an agent message in a gallery when the message has two or more images. Click
  an image in a chat to open it in a viewer. In the viewer, you can go to the next image and
  download the image.
- Read the changelog on openbot.run/changelog. It shows the changes of each release, and the steps
  to do after an upgrade. The Releases link in the footer now opens this page.
- Compare OpenBot with Grok Bot, Muse, Hermes Agent, OpenClaw, Manus, Claude Cowork and Devin on
  openbot.run/compare. The Grok Bot article moved from News to this section. The old link opens the
  new page.
- Open News, Guides and Plugins on openbot.run from a navigation menu that shows the latest
  articles. On a narrow screen, a menu button opens the same sections.
- Show the reading progress of each section on news, guides and comparison pages on openbot.run.
  You can share a link to one section.
- Show an animated 404 page on openbot.run, with links to the main sections.

### Changed

- Let an agent read all the replies of its teammates in one turn. Before, an agent that asked two
  or more teammates started one turn for each reply, and answered you again after each teammate. A
  message from you does not wait for the replies.
- Show the replies of teammates in the "Waiting for replies" block, not in the message queue.
- Move the AI providers to their own Settings tab, after General.
- Use the onboarding provider list in the Providers & permissions dialog and in the first setup
  after an invitation. You can add and manage a custom provider there. On a joined server, the
  dialog shows only the list.
- Show the reasoning efforts as a row of segments in the model picker. The header shows the effort
  after the model name. A provider that is not available is dim and shows a status dot.
- Give the action menus and the model picker a new look. Menus now close with a motion, and a
  submenu moves in from the menu before it.
- Check a hosted-site file path before the upload starts, with the same rule as the account server.
  A path such as `api/…`, `server/…` or `node_modules/…`, or a path longer than 240 characters,
  now shows a translated error.
- Show the Grok sign-in text and the skill folder warning in French and Japanese.
- Connect to joined servers again at once when the computer wakes from sleep. Before, the app
  could wait up to one minute, or longer for a host that was offline.
- Show images from a joined server again without a new download each time. The app keeps a copy in
  memory for 10 minutes.

### Fixed

- Keep a question from an OpenCode agent open until you answer it. Before, the question failed
  after 60 seconds with "Request timed out", and a later answer went to nobody. When a provider
  stops waiting for a question, the question now closes.
- Start a new agent on another signed-in provider when the default provider has no model. Before,
  an agent that created a new agent got the error "Grok has no available model." When no provider
  has a model, the error now tells you where to change the default provider.
- Give an OpenCode agent the full result of a Computer Use action. Before, the agent got only a
  summary, such as the number of windows, and could not select a window or an element.
- Show a teammate message that needs no reply as done when an OpenCode agent does not reply.
  Before, the message showed as failed, and the chat showed an OpenCode error.
- Show the cost of the default Codex model in agent usage. Before, the usage panel showed no cost
  for this model.
- Show the new server logo in server settings before you save it. Before, the settings showed the
  server initials.
- Keep the focus in the server name menu. A click outside the menu now only closes it. Before, the
  click also went to the page below.
- Generate the profile of a Gemini agent without its MCP servers and tools, as for OpenCode and
  Grok.
- Remove the incomplete copy when a copy of a local agent fails. Before, the incomplete agent
  stayed.
- Keep cached remote attachments in their cache folder. Before, some attachment IDs could write a
  file outside it.

## [0.22.0] - 2026-09-26

### Added

- Use Gemini with a Google AI Pro or Ultra plan. OpenBot downloads Google's Antigravity server to
  this computer and signs in through your browser. Members of a joined server do not see Gemini
  agents.
- Select More providers on the onboarding screen to add Gemini or a custom provider.
- Turn Computer Use off for one agent in its settings. Existing agents keep Computer Use on.
- Let owners and admins of a joined server manage the host from their desktop: agent access, auto
  approve, skills, shared tables, marketplace agents, provider keys and downloads, custom
  endpoints, and the server name and logo. Members can only read.
- Let owners and admins in the browser client use server settings, providers, the marketplace,
  agent skills, shared tables, auto approve, Try skill, plugin prompts and shared agents.
- Update an agent that was added from a marketplace listing to the current version of the listing,
  from the web client or from a joined desktop.
- Show the OpenCode Go quota in Usage when you save a Go key.
- Show the servers in a menu instead of the server rail. Select the layout in the server name menu.
  OpenBot keeps the layout for each device.
- Select the interface language on mobile.

### Changed

- **Workspace only is now enforced. An agent with Workspace only can write only in its workspace,
  the shared folder and the temporary folders. On Windows and Linux, a Grok, OpenCode or Gemini
  agent with Workspace only does not start. To use it, select Full access in the agent settings.
  Agents with Full access, which is the default, do not change.**
- Show more of the interface in French and Japanese.
- Install the latest provider CLI on a first download. If the release check is slow or fails,
  OpenBot installs the pinned version.
- Fade streamed text as a trail, and keep the fade across Markdown blocks.
- Show the server rail and the top row on one surface.
- Hide saved secret values in all logs, and write a local trace line when the main process fails.

### Fixed

- End the turns of a provider client that stopped. Before, these turns stayed in progress until
  OpenBot restarted.
- Keep queued messages when a file delete fails.
- Show a request timeout from any provider as a timeout.
- Sign out and revoke sessions correctly while remote sessions are open. Before, this failed with
  an error and the browser kept its session.
- Stop an error after sign-out in the web client.
- Move the focus back to the server name after a server row closes the menu.
- Correct one Japanese sentence.

## [0.21.2] - 2026-09-26

Version 0.21.1 was not published because its macOS and Windows builds failed. This version also
contains all changes of 0.21.1.

### Added

- Keep a local trace of IPC calls and provider turns in `logs/trace.ndjson`. Each line has only a
  time, a name, a duration and an outcome. The file stays on this computer. The diagnostics export
  adds a summary for each name.
- Add a test run to a saved routine on mobile, and show routine events in the mobile chat.
- Show the agent name and the latest message when you long-press an agent on mobile.
- Change the order of servers on mobile. Long-press a server and select Edit order.

### Changed

- Retry an offline remote host every 5 minutes while the app has focus, and every 15 minutes without
  focus. Before, OpenBot retried every minute.
- Send sign-in and invitation emails as HTML with a plain-text part. Out-of-office replies no longer
  answer these emails.
- Show a new design for the mobile server list and the agent appearance picker.
- Open the mobile photo picker faster, and move and scale an avatar photo in the app.

### Fixed

- Keep both keys when two providers save a key at the same time.
- Keep the stored session when you type a wrong sign-in code for a new challenge.
- Close the live browser view when its screencast cannot start again. Before, the view stopped on
  its last frame.
- Stop an error in the sidebar when you switch servers.
- Send desktop host analytics events with the app origin. Before, the analytics server refused all
  of them. When you turn analytics off, OpenBot does not send these events.

## [0.21.1] - 2026-09-25

### Added

- Publish an agent as a template that other people can add. Press Publish in the agent chat header.
  OpenBot sends the instructions, the routines and the skills to openbot.run. Files and memories are
  not sent, and a field that looks like a secret stops the publish. The link opens a page at
  `openbot.run/agents/<id>`. Add to OpenBot shows the template in the app, and OpenBot adds the agent
  only when you click Add agent. Unpublish removes the template. A new publish keeps the same link.
- Edit a routine schedule with chips in the routine panel and in the routine card in the chat.

### Changed

- Show the account profile name and avatar in the browser client.
- Show that a sign-in server does not accept OpenBot when it refuses the registration, for example
  Figma. Before, OpenBot showed a credentials error. The Figma listing tells you to use the local MCP
  server of the Figma desktop app.
- Get faster answers from the account server.

### Fixed

- Delete an agent on Windows. Before, deletion failed with EBUSY because a provider session kept the
  agent workspace open.
- Remove a deleted agent from its channels. Before, the channel showed an Unavailable member.
  OpenBot also removes these members at startup.
- Start OpenBot on Linux from a terminal. Before, the window could freeze at startup.
- Send a steer message with the same framing as a new turn.
- Redact each line of remote diagnostic logs.
- Show an error when the copy of a channel message or a plugin link fails.
- Use the fallback name for a download with a bad file name.

## [0.21.0] - 2026-09-24

### Added

- Import agents from Grok Bot in Server settings, Import. Add the OpenBot export agent to Grok Bot,
  send it one message, and choose the `.zip` file it saves. OpenBot imports each agent you select
  with its instructions, avatar, skills, routines and memories, and optional workspace files. The
  file is read on this computer and is not uploaded. Chat history is not copied.
- Dictate a message on mobile. With an empty message field, press the microphone. The text shows in
  the field while you speak, and you send it when you are ready. Set the language in Settings,
  General, Dictation.
- Delete a channel from the channel row menu on mobile. Only server owners and admins see Delete.
- Show Skills and Files in the agent info on mobile.

### Changed

- Use less memory and CPU. OpenBot stops a provider CLI that no agent uses after 60 seconds, keeps
  fewer idle Claude, OpenCode and Grok sessions open, and streams attachments from disk. The first
  message to an agent after a long idle time can take a little longer.
- Scroll and type with fewer frame drops in the mobile chat and agent list.
- Use a darker dark-mode background for the mobile screen, drawer and sheets.
- Show the provider Update button on the same row as the update message.
- Save an agent with empty instructions on mobile.

### Fixed

- Remove a question or approval from the screen when its provider stops. Before, it stayed until a
  restart, and each answer failed.
- Keep the approvals of other providers when one provider stops.
- Keep pending questions and approvals in the web app when the host sends a partial update.
- Type Chinese, Japanese and Korean with an input method in the message field. Before, a Latin
  letter went in before each segment.
- Show the size of a stored file that is a link, not the size of its target, in Storage.

## [0.20.1] - 2026-09-23

### Fixed

- Keep an animated WebP avatar animated after upload. Before, OpenBot kept only the first frame.
- Hide the secret code input while OpenBot sends the code. The input shows again if the code fails.
- Wrap long text in the avatar upload control.

## [0.20.0] - 2026-09-23

### Added

- Show the skills in an agent's workspace skill folders that OpenBot did not install, such as
  `.agents/skills`. OpenBot does not change these folders. A skill shows a problem when its
  `SKILL.md` is not valid, or when the agent's provider does not read its folder.
- Show disk use and files in a Storage tab in Server Settings, a Files view in agent settings, and a
  Files panel in the chat. An owner or an admin can delete a file and clear caches and logs.
- Mute a server for a set time or until you turn it back on, and set its notification level: all
  activity, only when it needs you, or nothing.
- Send a test notification and open the system notification settings from Settings.
- Mark an agent as Workspace only in the agent settings. The setting is not enforced yet.
- Check for provider CLI updates from a provider's actions menu. OpenBot offers the latest upstream
  release of Codex, Claude, OpenCode, and Grok without a new OpenBot version.
- Add Linux arm64 builds.
- Add a Composio listing that takes your own MCP link.
- Show file type, size, previews, and upload progress for attachments on mobile, and show images
  that an agent generates.

### Changed

- Accept a skill description of up to 1024 characters, as the Agent Skills specification allows.
- Desktop notifications now appear. **If you turned off desktop notifications, turn them off again
  in Settings.**
- Show the open agent's provider in the usage chip.
- Apply edited agent instructions to Codex and Claude sessions. The agent keeps its thread.
- Ask for confirmation in one shared dialog everywhere.
- Hide the query string of an MCP URL in logs, and mask MCP header and environment values in the
  server MCP panel.
- Send fewer requests to the account service. Without app focus, an offline host retries after 15
  minutes.

### Fixed

- Make Apple and Google sign-in work in the embedded browser.
- Open OpenBot on a second launch after a quit that did not finish on Windows.
- Show new chat replies when reduced motion is on.
- Center the idle emoji in the Dynamic Island.

## [0.19.0] - 2026-09-23

### Added

- Use OpenBot in a web browser at openbot.run/app with your account and your connected hosts.
- Set the Dynamic Island width and height in the new Dynamic Island settings tab on macOS.

### Changed

- Show every model a provider reports, newest first. When a provider no longer lists an agent's
  model, the agent moves to the provider's default model and keeps its thread.
- Use less memory: close a provider CLI after 10 idle minutes and resume its session on the next
  message, restore only the active browser tab at startup, and keep fewer messages of closed agents
  in memory.

### Fixed

- Show one notice when a Codex plan reaches its usage limit, not an extra "could not continue" error.

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
- Stop showing a refused routine as a provider error; the agent now gets the reason and can correct it.
- Keep failed Codex background refreshes out of provider error messages.

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
