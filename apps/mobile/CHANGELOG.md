# Changelog

All notable changes to the OpenBot iPhone app will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md). The changes of the desktop app and the web client are in
the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [1.4.3] - 2026-10-29 (iOS)

### Added

- The Marketplace now lists Neon, Prisma, Netlify, Railway, Atlassian (Jira and Confluence), Todoist and Hugging Face.
- Attach MP4 videos in chat when the host runs a version of OpenBot that accepts them.
- The sidebar has Workflows. See the workflows of a server, the status of each last run, and the runs that wait for you.
- Pin a workflow to the sidebar. A pinned workflow shows its last run, and its button runs it or opens the run that waits for you.
- Open a run to see the status and output of each step. Approve or decline a step that waits, retry a step that failed, or stop the run.
- Edit a workflow on the phone: change its name and trigger, add steps, change their settings, move them, duplicate them and delete them. Make a new workflow with the + button.
- The Marketplace now lists Trello. Agents can work with your boards, lists and cards after you sign in to Trello.
- Dutch interface. Choose Nederlands in Settings > App language, or keep System default on an
  iPhone that uses Dutch.
- An owner or admin can connect Bitwarden or Vaultwarden on a joined server, in Server settings ›
  Connectors. Enter the server address, the API key and the master password. The server keeps them;
  the phone does not.
- An owner or admin can manage the Vault of a server in Server settings › Vault: add, change and
  delete logins, cards and contact info, and import passwords from a CSV file. The phone can set a
  new password, card number or security code, but it never shows a saved one.
- Server settings > Providers can save the API key of DeepSeek, OpenRouter and Inception on the
  server. Agents on these providers show in the agent list and the model picker.
- Server settings > Providers shows the mark of each provider, and a Default provider choice for
  the new agents of the server. The choice needs an updated server.
- An owner or admin can add, change and delete the API keys in a server's Vault from the iPhone app,
  when the server has the OpenBot version that keeps API keys. The phone sends a new key once and
  cannot show a saved key.
- An agent's chat has threads, as on desktop. Tap the agent's name in the chat header to open the thread menu: switch to the main chat or to an open thread, start a new thread, see all threads, or open the agent's info. A dot in the agent's color on the name, and beside each thread in the menu, shows a thread with messages that you have not read, on the phone or on desktop.
- Start a new thread from the thread menu, or with + on an agent's Threads page. Your first message starts it, and the main chat does not change. The + on the Threads page of the server asks which agent starts the thread.
- Send files in a thread, as in the agent's chat: tap + in the thread composer. The server must have the newest version of OpenBot.
- Rename, archive, restore or delete a thread from its ⋯ menu, or touch and hold a row on the Threads page. A thread that runs cannot be deleted until you stop it.
- On iPhone, you can send a share to an agent without opening the app. Tap Share in another app, tap OpenBot, choose the agent and tap Send. The iOS share sheet also shows the agents that you send messages to, so you can tap one of them directly. When the share cannot be sent, such as with the app lock on, OpenBot opens with the share as before.
- You can now talk with an agent by voice, as on the desktop. In an agent chat or a channel, tap the microphone in the message field. The message field turns into a call bar with the agent's glow, and the chat stays in view. The agent listens until you stop speaking, sends what you said, and reads its answer aloud while it writes it. Then it listens again. In a channel, the call bar shows the leader. When the leader gives the task to a member, the bar changes to that member, and it reads the first agent that answers. The call bar mutes the microphone, interrupts the answer, and ends the conversation.
- A new Voice page in Settings, with a Listening tab and a Speaking tab. Choose the voice that reads replies: Supertonic 3, the same voice as on the desktop, which you download once and which runs on your phone, or ElevenLabs with your own API key. You can choose a voice, listen to a sample, and remove the model or the key.
- Speech recognition in more languages, as on the desktop. In Settings > Voice, choose what recognizes your speech: the phone recognizer, which hears one language; Parakeet v3, which you download once (670 MB), runs on your phone and finds the language you speak in 25 European languages; or ElevenLabs Scribe with your own API key, which finds more than 90 languages. The choice applies to voice conversations and to dictation. Parakeet needs a phone with 6 GB of memory or more.

### Changed

- The developer of each Marketplace app now shows as a name, for example "Notion", not as a web address.
- In the message queue, tap a teammate's answer to steer it into the running turn. Before, the
  answer had no actions and waited for the turn to end.
- The app icon has a new design, with a dark appearance on iOS.
- Settings > About opens the privacy policy on openbot.run instead of GitHub.
- The Threads row of the server menu shows how many threads have unread messages, not "needs you".
- The Threads page puts threads in Working, Unread, Read and Archived sections. A host that does not keep read marks still shows Needs you, Working and Waiting.
- Tasks are now called threads, as on desktop. The Tasks page is now Threads, and Close and Reopen are now Archive and Restore.
- The agent's chat no longer shows a card for each open thread. The thread menu on the agent's name lists them.
- A long press on an agent, a channel, a workflow, a thread or a server gives a vibration when its menu opens, so you know when to lift your finger. On Android, the menu also opens sooner.
- In an agent chat and in a channel, the microphone now starts a voice conversation in place of dictation with review. When no voice is ready, it opens Settings > Voice. Threads still dictate a message that you can review before you send it.

### Fixed

- An SVG or HEIC path in an agent answer showed as code. It now shows with a file badge, like
  other file paths.
- When you return to the app, channel pictures no longer fade while the app connects again quietly. Agents already stayed visible.
- On Android, the top edge fade no longer covers the top of the screen title before you scroll.
- On Android, a menu with a long item, such as the agent menu, now holds all its items. Before, the last item went out of the bottom of the menu.

## [1.4.2] - 2026-10-27

### Added

- Show the Cursor plan usage of a server in Plan limits, with one window for Cursor's own models and one for all other models.
- The server drawer has a Marketplace. It shows a featured agent, popular agents, apps and popular skills. Owners and admins can add an agent, add a skill to the agents they choose, and connect an app with a key or a browser sign-in. The search field at the bottom has a filter menu for the type, the category and what the server already has. Tap the arrow on a skill or a connected app to try it: the example request opens in the chat of an agent that can use it. Skills that a message names now show as their name, not as a code.
- In a chat, type `@` to pick a skill of the agent or a connected app as well as a teammate, or tap + and then Use skill or app. The message names the skill or app, so the agent uses it.
- The mobile app now previews the files that desktop and web preview: text and code files, JSON, emails, HTML pages, PDFs and Excel spreadsheets. Before, these files opened only in the share sheet.
- A visual reply from an agent now shows its page in the chat, as on desktop.
- When the owner of a server changes the server key, the app follows the change that the old and the new key both signed. Before, the app showed "Server identity changed" and asked for a new scan.
- Korean interface. Choose 한국어 in Settings > App language, or keep System default on an
  iPhone that uses Korean.
- Simplified Chinese for the phone app. Select 简体中文 in Settings, or use a Chinese phone language.
- A server's Anthropic API key shows as the "API key" account in an agent's account choice. Select
  it to bill that agent to the key.
- Show a dot on the tab button of the browser when a page opens a new tab behind the tab on screen. The tab list marks each new tab with the same dot. The dot goes away when you show the new tab.

### Changed

- When you type `@` and part of a name, the agents whose name matches show first, then the agents
  whose title matches, then the agents whose description matches. The match ignores accents, so
  `e` finds `é`. Before, eight agents that matched only in their description could hide the agent
  that you named.
- The hosted server plans show that the Starter plan is sold out.
- The mobile app uses Expo SDK 58 and React Native 0.88.
- Agent photos stay on the phone. A photo that the phone has shows at once, also before the app connects, and the app does not download it again. Each photo downloads one time, not again for the Live Activity. The phone keeps up to 20 MB of photos. The photos of a server go when you remove the server, and all photos go when you sign out.
- The agent settings no longer say that Grok cannot steer a running turn. A desktop app or a server
  with this release steers the message into the running Grok turn.
- In the browser, the tabs button opens a sheet. The address field shows the site of the page. Tap it to type an address or a search. It has buttons to go back and forward, copy the link and reload the page. The sheet also has New tab, Share and Close tab, and the list of the agent's tabs. You can close each tab in the list.
- An HTML file and a visual reply open as a live page, as on desktop. The page runs its scripts, follows the light or dark theme of the app, and fills the space under the header. A tapped web link opens in the browser.
- A visual reply shows in the chat as the page itself, with no card. Tap it to open it.

### Fixed

- On Android, a swipe left or right in the image viewer of a chat now shows the next or previous image. Before, the swipe only moved the image and it went back to its place.
- The plan limit rings in the header now show the last reading at once when the app opens or you change the server. Before, they went away until the server sent new limits.
- With the app lock and Face ID on, the app no longer asks for Face ID while the phone is locked. It now asks only when you open the app.
- A chat that you opened before now shows its messages at once when you open it again. Before, a chat with more than 50 messages lost its messages when you left it and waited for the server.
- An open chat no longer reads its messages from the server again when the phone already has them. This applies when you open a chat, mark a chat read and when a reply ends.
- The app asks the server for unread counts once, not once for each message, while replies arrive.
- An hourly routine can now run between two times that cross midnight, for example from 8:00 PM to 10:00 AM. Before, the routine editor showed "The end time must be after the start time." and did not save the routine. A run after midnight uses the days of its own date: with Monday to Friday, a run at 2:00 AM on Saturday does not occur.
- On Android 12 and 13, the app no longer closes unexpectedly while the splash screen goes away. Before, version 1.4.1 did not include the fix.
- When you open the app again after a short time away, it connects to a server again in seconds. Before, on a server that uses a relay, the app could show the server as connected and load no chats for up to a minute.
- The chat on screen loads before task lists, routines, usage and agent photos. Before, these reads for every agent went first after you opened the app again, and the chat waited behind them.
- Live Activities cut a long code span with emoji at the correct length. Before, the cut could split
  an emoji into half a character, and the text stopped too early.
- Live Activities show a reply that starts with inline code in three backticks, such as
  ```` ```npm install``` first ````. Before, that line disappeared and the next lines showed as code.
- On Android, selected text in the message box and other text fields stays visible in light and dark mode.
- Show long model names in full in the model menu on Android. A long name goes onto more than one line.
- Open chats faster on Android. The latest messages show while the chat slides in.
- Open the sidebar more smoothly on Android, also the first time.
- Make the app respond faster while a server sends or receives many requests.
- Keep the app connected while a server sends many events. Before, it disconnected and connected again every few seconds during a turn.
- In a chat, a scroll that starts on a link does not open the link. Only a tap opens it.
- In a chat, a link shows the icon of its website, as on desktop and web.
- When you open the app, it connects to the server at once. It no longer waits for the rest of a retry countdown, such as the two-minute wait after five failed attempts.
- A connection attempt that Signal closes, such as when the server is offline, fails at once and is tried again. Before, it waited 30 seconds.
- A reconnect loads the agents, the read state and the sidebar sections one round trip sooner.
- When you open the app again, it reconnects in the background and does not show "Reconnecting" for a few seconds. The first connection attempt no longer fails because the app still seemed to be in the background.

## [1.4.1] - 2026-10-23

### Added

- MP3 and other audio files in a chat play in the conversation. The card shows the waveform of the file, as on desktop. Tap or drag the waveform to move the position, and tap the speed button to play at 0.5×, 1×, 1.5× or 2×. Before, you could only download them.
- A Markdown file in a chat opens in a preview that shows the formatted text. The menu shows the source, copies it, or shares the file. Before, you could only download it.
- Tap any image in a chat to open it, then swipe left or right to see all the other images of the loaded conversation, in chat order. The top bar shows the position, such as "3 of 8". ([#2426](https://github.com/nightly-labs/openbot/issues/2426))
- When an agent sends two or more images in one reply, the chat shows them together in a compact grid, as on desktop. Before, each image took the full width of the chat.
- Channels are back in the mobile app, on a computer whose OpenBot has channels again. A channel
  shows in the home list beside your agents, and you can pin it, hide it, put it in a section, and
  search it. It opens in the same chat as an agent, with the author of each message, plan cards,
  questions, approvals and browser steps of its work. To make one, open the menu at the top of the
  home screen and tap New channel. The channel info holds its agents, its lead, its memories and its
  routines.
- Deleted channels is in the menu of the home screen, beside Hidden chats, when the server has a
  deleted channel. It has a Restore button for each channel, for the people who can delete a
  channel. Before, a deleted channel was preview only, and the list was in Settings.
- A tap on a notification of a question, an approval or a browser step in a channel opens the
  channel. Before, it opened the chat of the agent.
- A channel has the browser button. It opens the browser of the agent that asks for a browser step,
  or else of the lead. In the browser, tap the agent at the top to switch to the browser of another
  agent of the channel.
- Owners and admins can now choose what a scheduled routine does when the server was off at its
  time: skip the run, or run it once when the server is back. Before, only the desktop app and the
  web client had this choice.
- Owners and admins can now choose where an agent routine sends its answers, as well as to its
  chat: a Slack, Discord or Telegram place of the server. The server must also run the new desktop
  version.
- The home header shows the plan limits of your providers as rings, as the desktop sidebar does. The two providers with the least left show, then the number of the others. Tap the rings to see each limit window, how much is left and when it resets.

### Changed

- The Usage screen now shows tokens without cache reads in its total, chart and shares. Before, the
  total also counted cache reads, which repeat the cached conversation on each model request. The
  token breakdown still shows cache reads as Cached input. The token chart shows one total line
  instead of one line for each provider.
- In a chat with an agent that your roles let you only view, the chat has no composer, and a note says that you can only view this agent.
- A member page has a Roles row that shows the roles of the member. The row opens the Roles page of that member, where you turn each role on or off. You create and edit roles in Server settings > Roles.

### Fixed

- Agent instructions longer than 2,000 characters no longer get cut silently. Before, a long paste
  dropped the rest of the text with no warning. Now the field keeps all the text, shows a character
  count near the limit, and shows an error when the text is too long. You cannot save until you
  shorten them.
- The image viewer starts and ends its open and close motion on the UI thread. It no longer waits for a busy chat, and a picture dragged closed after the chat moves goes back to the correct place.
- The chat of an agent that works in a channel no longer says "Waiting for your input on desktop".
  A card names the channel, and a tap opens the channel, where you can answer on the phone.
- In the home list, an agent that waits for you in a channel says "Waiting for you in" and the
  channel name. Before, the row showed the last message of its own chat.
- In a channel, an agent that waits for an answer, an approval or a browser step says so. Before, it
  showed "Thinking…".
- The browser button in the chat header has its glass on iOS. Before, only the globe showed.
- On Android, the app no longer closes when a chat shows a large image. The app now keeps a downloaded image as a temporary file and shows it from the file.
- On Android, the app could close while a text field had focus.
- On Android 12 and 13, the app no longer closes unexpectedly while it opens and the splash screen goes away.

## [1.4.0] - 2026-10-21 (Android), 2026-10-22 (iOS)

### Added

- A video that an agent attaches to a reply now shows in the chat with its first frame and its length. Tap it to play it on the whole screen, with play and pause, a timeline, mute and a full-screen view. You can share the video or save it to Photos from the player. Videos up to 10 MB play on the phone.
- Add a Tasks page for each server. Open it from Tasks in the server drawer. Tap + to start a
  task: write what to do, then tap the agent in the list. The page groups the tasks of all
  agents by what they need: Needs you, Working, Waiting and Closed. Tap a task to read its
  messages, send a message to it, or stop, close or reopen it. A server shows Tasks when it
  supports tasks.
- An agent's chat shows each open task of the agent under its activity, with what it does now or
  how it ended. A finished task stays until you close it with its close button. Tap a task to open
  it. A task opens as a chat, with the agent's messages, voice input and a text composer. In a
  task, you can answer the agent's questions and see what it does now.
- Attach ZIP archives in chat when the host runs a version of OpenBot that accepts them.
- Server settings has a General section for owners and admins: Timezone sets the zone of new routines when the message does not give one, and Memories per agent sets how many memories each agent can keep. The server must have an OpenBot version that supports these settings.
- Server settings has a Storage page, as on desktop. A ring chart shows how much space OpenBot uses on the server by type, with the size and share of each type. Tap a type to highlight it in the chart. The page also shows the agents and the largest chats, and the free disk space. Tap All files to open, share or delete a stored file. Owners and admins can clear cached server files and logs. The server must have an OpenBot version that supports storage.
- Server settings has a Sites page, as on desktop. It shows the sites that agents on the server published to openbot.site, the number of sites and the limit of your plan, and when each site expires. Tap a site to open it. Owners and admins can also delete a site. The server must have an OpenBot version that supports sites.
- Server settings has an Updates page, as on the desktop. It shows the OpenBot version of the server and the update status. You can check for updates and start an update. Owners and admins can also restart the server now, cancel a scheduled restart, and turn automatic downloads and automatic installs on or off. Members can start an update that waits until the agents are idle, when the server permits it.
- Server settings has Providers for owners and admins, as in OpenBot on the computer. It shows each AI provider of the computer that runs the server and its status. Tap a provider to connect it, download it, check for updates and update it, or save its API key. The server must have an OpenBot version that supports provider management.
- Server settings has Connectors for owners and admins, as on the desktop. Connect Slack, Discord, Telegram, GitHub and 1Password on the server, see the status of each connection, pause or resume it, reconnect or disconnect it, and add the orchestrator agent that answers. GitHub shows the repositories that agents can use. Bitwarden shows as a desktop-only connector. The server must have an OpenBot version that supports connectors.
- Server settings has MCP servers for owners and admins. Add an MCP server that runs a command or connects to a URL, change it, turn it on or off for the agents, test the connection, sign out, or remove it. Each argument, environment variable and header has its own field, as on desktop. The server must have an OpenBot version that supports MCP servers. To sign in to an MCP server, use OpenBot on a computer.
- App lock: in Settings > App lock, turn on a 4-digit PIN, Face ID, Touch ID or the phone's unlock, or a PIN and one of the others. OpenBot then locks when you leave it for the time that you choose, from immediately to 1 hour, when the phone locks, and each time the app starts. A notification or a link that you open while the app is locked opens after you unlock it.
- While the app lock is on, the app switcher shows the OpenBot logo instead of your chats. On Android this needs Android 13 or later.
- After 4 incorrect PINs, each new attempt waits longer. After 10 incorrect PINs, OpenBot signs you out on the phone. If you forget the PIN, sign out from the lock screen and scan a new code from OpenBot on your desktop.
- Server settings has Roles, below Members. An owner or admin creates roles, sets the access of Everyone and of each role to each agent (no access, view, chat or manage), and gives roles to members on the member page. The members list shows the roles of each member. The server must run an OpenBot version with roles.

### Changed

- Shorten button and tab labels in all 9 translations, so that more labels show in full.
- Admins can now change a member's role and remove a member on the Members screen, as the owner
  can. Nobody can change or remove the owner.
- Set what an agent may do with one picker: Workspace only, Ask first or Full access. It replaces the
  Access picker and the Auto approve switch. Claude agents show Workspace only and Full access.
- Show a quote that a desktop message contains as its text in quotation marks.
- The chat scrolls more smoothly, mostly in long chats with tables, code and media. It prepares the messages one screen above and below the visible ones, so a quick scroll shows messages at their full size instead of empty space, and a message that you send moves to the top of the chat in one movement.
- During a quick scroll, a page preview, a diagram, a video and code colours keep their space and show when the chat slows down, so the scroll does not stop for them.
- A long reply shows its words more smoothly while it arrives. Each new word draws only its own paragraph, list or table, not the full reply again, so the chat scrolls without stutter while an agent writes.
- Sending a message and the start of a reply no longer make the chat pause for a moment. The messages that are already in the chat stay as they are.
- Typing in the composer and receiving a reply at the same time is smoother. The composer and the message list draw again only when their own content changes.
- The app and its updates are smaller to download, and the start screen opens a little faster. The app icon and the start screen pictures use less space and look the same.
- The chat list has a new layout. The server name is a large title at the top, and it moves into the bar when you scroll. Tap it to open the server drawer.
- Search is now a field at the bottom of the chat list. Tap it to see shortcuts to Routines, Usage, Members, Server settings and your agents, then type to find chats, messages, files, routines and settings. Type @ and an agent name to open a new task for that agent: describe the task in the field and press Return. Above the field you see ideas from the agent's earlier tasks and its open tasks. Tap the agent to choose another one; your text stays. After you start the task, the field shows for 2 seconds that the agent started it. If the task cannot start, the field turns red; tap it or wait, and the task opens again with your text.
- The server drawer is simpler. Tap the server name to show all your servers in one list. Below it, Routines, Usage and Members show their current values, and Server settings opens the server options.
- The app opens on the first server in your list. To change it, touch and hold a server and choose Edit order. The separate default server is removed.
- Routines and Usage open as full screens, not as sheets.
- The server drawer shows Tasks with the number of tasks that need you. The agent sheet has a Tasks row that opens the tasks of that agent.
- Search shows the tasks that need you when you open it, a Tasks shortcut, and the tasks whose title matches what you type.
- Names, previews, section headings and times in the chat list use new text sizes, so the list is easier to scan.
- New task shows the agents in a list. Tap an agent to give it the task. The keyboard does not open until you tap the text field.
- On Android, the headers of the chat list, Tasks, Routines and Usage have a bold title and round glass buttons, and sheet titles are next to the close button. The search field is higher, above the gesture bar, and blurs the list behind it on Android 12 and later. The search field no longer moves down when search opens.
- In a chat, an approval request shows as a message bubble with Allow and Deny buttons under it.
- In a chat, each open task shows as a card with its title and its status. A spinner shows while the task works.
- Members is a simple list of the people on the server and the email invitations that wait for an answer, with the number of members and the limit of your plan. Tap a person to see their role, change it or remove them. Owners and admins tap + to invite people.
- Invite people is a separate page. Choose an email invitation, a one-time link or a permanent link, choose the role, and tap the check mark. You can copy or share a new link, and tap an active link to revoke it.
- Server settings has a cleaner layout: the logo and name at the top, then the status, your role and the number of members, the settings, the notifications, the connection actions, and Leave or Remove at the bottom.
- When you open search, the results come in with the keyboard and the chat list moves up and fades behind them. When you close search, the results fade and the list comes back. The close button fades out as the field gets wider.
- The search field gives a soft tap when you open search, and a light tap when you clear the text.
- After you start a task from the search field, the message that the task started or failed fades in with its color, and the field fades back after it.
- Search has more space between its sections, such as Needs you, Go to and Agents. The hint about @ below the agents is removed, because the search field already tells you.
- Product analytics also counts these actions now: sign-in with email, the hosted server plans, the first-run steps, notification and Live Activity settings, voice input, agent template installs, and the agent and server Usage pages. It sends no names, message text, IDs, links or email addresses.
- When you turn off **Share product analytics**, the app sends one last event that records the change. Then it stops all analytics.
- Server settings put their options in sections: status, role and members at the top, then General, AI and tools (Providers, MCP servers, Connectors), Data (Sites, Storage), Notifications and Maintenance (Updates, Refresh, Restart). A section that has no options for your role does not show.
- The mobile app uses the Inter font, as the desktop app and the web do. Headers, toolbar buttons, switches and text fields use it too. If Inter is not available, the app uses the system font.
- The sign-in screen has a new design. A lilac face covers the screen when the app opens, then moves up to become the header above the sign-in choices. It gets smaller for the email and code steps, and its eyes follow what you type.
- When you scan a QR code, the face covers the screen again and its eyes become the corners of the scanner frame. When the phone connects, the face smiles and shows "Connected" before your agents open.
- The app loader is now the same face. It covers the screen while the app connects, its eyes look around as it thinks, and the status shows at the bottom. When the app is ready, the face rolls up and shows the screen below it. The small loader is removed.
- The launch screen is lilac with the eyes of the face, so the app opens without a jump. In dark mode the launch screen and the loader use a darker lilac, so they do not flash.
- The lock screen uses the same face. The face covers the app in the app switcher, moves up to a header above the PIN pad or Unlock button, and rolls up when you unlock. The drawn background is removed.

### Fixed

- Fix translations with the wrong meaning or a mixed term. Before, the Polish app showed some
  Russian text.
- Routine calendars now use the earliest next scheduled time when clocks move back. Some schedules skipped a run in the first occurrence of a repeated hour or missed a run when the clock moved back several hours.
- The Live Activity now follows the notification choices of each server. Before, it showed the
  agents of a server that you muted or set to Nothing. Now it stops showing that server at once when
  you mute it or turn its notifications off, and it shows the server again when the mute ends.
- The app can now read the queue of an agent with a long history. Before, after some weeks of use, the queue answer was too large for the connection, and the chat showed a "response too large" error. The server must also run the version of OpenBot with this fix (#2368).
- Live Activities show a link that an agent reply writes in angle brackets, such as
  `<https://example.com>`. Before, the Live Activity removed the link.
- Agents and sections stay in the home list when you go back from a chat. Before, some or all
  agents could disappear from the list, and only a collapse and expand of their section showed them
  again.
- Paste in the message field now adds copied photos, videos and other supported files as
  attachments. Before, a paste of a photo did nothing.
- The app no longer stops when you tap Back in a chat and swipe back from the left edge at the same
  time. Before, the two actions closed the chat twice, and iOS stopped the app.
- On Android, scrolling a long chat with code or file names in the replies was slow and dropped frames. Code and file names now stay in the text of their paragraph.
- On iPhone, the text in a message bubble sat too low, with more space above it than below it. The text is now in the center of the bubble.
- The chat shows the queue button again when you have queued messages. Before, rows with Steer and Edit above the message box replaced the button for up to three messages. Tap the button to steer, edit, reorder or delete a queued message.
- An agent that works on a task no longer shows "Waiting for your input on desktop" in its chat.
- A turn that fails because the OpenCode key expired now says "Your OpenCode API key expired" in your language, and tells you to paste a new key in the OpenCode settings. Before, it showed "Internal error".
- On iPhone, a long message that waits to be sent no longer goes past the edges of the screen. Its text wraps in the bubble, as in a sent message.
- On Android, a long menu, such as the dictation language picker, cut off its first items above the screen and did not scroll, so you could not select English. A long menu now fits in the screen and scrolls.
- Titles, agent names and section headings use their bold and semibold weights again.
- After a Signal restart, the iPhone app no longer connects again at the same time as all other devices.
- Server settings no longer show empty separator lines where an option is not available.
- The server status in Server settings uses the same text size as the other values.
- Rows in Settings, About, Sessions and Support use the same text size as Server settings.
- On Android, chats and other screens open and close more smoothly from the chat list. The search field stops its blur of the list while another screen opens, shows or closes, and while the search results show.
- An open chat no longer renders again when another agent or server changes.
- The server drawer, the chat header and the chat list no longer render again for workspace changes that they do not show, so the phone does less work while you use any screen.
- The model list of an agent loads when the server has a provider that the app does not know. An
  agent on that provider shows "Update OpenBot to use" and the provider name, and its provider
  and model choices are disabled.
- The phone screen stays on while voice mode listens, so the screen lock no longer stops the voice input when you do not touch the phone.
- A task that has no messages yet, for example a task that waits for the provider usage limit to reset, now shows why it waits and its queued messages. Before, the task screen was empty. A new chat with no messages shows its starter card again.

### Security

- Show the account service address on the Mobile Connect screen when a link uses a service that is
  not the OpenBot account service. Before, the screen did not show where the phone connects.

## [1.3.2] - 2026-10-17

### Added

- Touch and hold a server in the server list to leave it, or to remove a server that you own. Before, these actions were only in the server options.
- You can react to a message with an emoji, and you can see the reactions of you and your agents under each message.
- Select part of a message to Explain, Improve, Shorten, change the Tone or fix the Grammar of it, as in the desktop app. This works for the agent's replies and for your own messages. To describe your own edit, write it in the message box. Tap outside the message to end the selection.
- Queued messages show above the message box, with Steer and Edit on each message.
- An owner or admin of a server can select the provider account of an agent in the agent's Model settings. The choice shows when the provider has two or more accounts on the server.
- A new account now starts with a short animated welcome. It helps you connect a server, then choose a starting role for your first agent or make your own from scratch, give it a name and a first task. You can skip it at any step. When you skip the welcome, its characters stay where they are, and its text and main button change into the home's.
- A working agent has turning rings around its avatar on the home screen, as on the desktop.
- Hold the app icon to open a recent agent, Routines or Search. The recent agents are the chats that
  you opened last on this phone. Hidden chats do not show. The actions go away when you sign out, and
  a shortcut that you pinned on Android then opens only the sign-in screen.
- Share a link, text, a photo or a file from another app to an agent. Choose OpenBot in the share
  sheet, then choose the agent. The agent that got your last share is selected first. The chat opens
  with the shared content in the message field, so you can add a message before you send it. This
  works when OpenBot is closed and when it is open. A file that is too large or of a type that agents
  cannot read shows an error with its name. An image that you share from a web page comes as an
  image, not as its link. iPhone photos in HEIC format are sent as JPEG.
- Get agent notifications on Android: when an agent finishes, stops with an error, or needs your
  input, an approval, or a step in the browser. Choose them in Settings > Notifications, with a
  sound and the events of each server. The server must run the newest OpenBot desktop app.
- When you create an agent, you can select its provider, model and reasoning level. The choice shows when the server supports it. "Host default" keeps the provider that the server selects for new agents.

### Changed

- Copy, React, Reply and the time are now in a row under each message. Before, they were in a sheet that opened only when you touched and held a message.
- On iPhone, touch and hold a word in a message to select it, as in other apps. The formatting of the message stays while you select. Before, the text opened in a separate sheet as plain text. On Android, tap Select text under the message.
- The home of a server with no agents now has the layout of the welcome: its group of characters, the text under it, and the Add agent button at the bottom. Before, smaller characters stood in a ring around the text and the button.
- After you sign in, the OpenBot logo moves to the middle of the screen and turns into the loading animation, and your agents come in while it leaves. Before, the screen faded, the loader grew from a dot, and the list waited until the loader was gone.
- When you open the app while signed in, the splash logo turns into the loading animation. Before, the loader showed on top of the splash logo.
- Signing out now fades to the sign-in screen. Before, the sign-in screen slid in from the side.
- While the app connects to a server, the home screen no longer shows the server, search and options buttons. They come in with your agents.
- Admins of a hosted server can now restart it from Server settings. Before, only the owner could restart it.
- The home screen stays smooth on a server with many agents. A new message updates only the row of
  its agent, and the list keeps fewer rows ready off the screen.
- Agent avatars draw with less work, mostly on Android. A working face plays at 30 frames per second
  on Android, as on the desktop.
- On Android, a chat slides in as soon as you tap its agent, and its messages show when it is in
  place. Before, the chat came only after all its messages had rendered.
- On Android, the home screen no longer keeps a long-press menu ready for each agent. The menu is
  made when you touch and hold the agent.
- A chat opens with less work. The app reads the phone's language once instead of once for each
  message, keeps message rows from drawing again for each change in the chat, and reuses the
  formatted text and highlighted code of messages it showed before.
- Sheets with header buttons on Android, such as Create agent, no longer rebuild the header on each
  key press. The colour glow and the face choices of Create agent change colour with less work.
- When you come back to the app, it no longer shows "Reconnecting" while it connects again. For up to 5 seconds, servers, avatars and chats look as you left them, and actions that you start wait for the connection. The status shows only when the connection takes longer or fails.
- The app is smaller and opens the chat list faster. It loads the math and code highlighting tools only when a message needs them.
- A long reply streams more smoothly. Before, the app read the full reply again for each new part of it.
- While a server reconnects, the app does less work each second. Before, the countdown made all of the open screens draw again.
- When the server supports it and you are an owner or an admin, an agent that you hide on the phone is hidden on each device that shows the server, and an agent that you hide on the computer is hidden on the phone. The server does not run the routines of a hidden agent and does not send new messages to it. Restore removes the hide on the phone and on the server. A member hides an agent on the phone only.
- On Android, popup menus have the OpenBot design: rounded corners, app colors, and icons. Before, they used the default Android menu with the colors of the device wallpaper.
- The Android app is a smaller download.

### Fixed

- In Italian, the email sign-in screens now show in Italian. Before, they showed in English.
- Some errors about open waits, routine flows and provider sign-in now show in the selected language. Before, they showed in English.
- Edit on a message that waits to send no longer deletes the saved message. Before, when you left the chat or closed the app before you sent the change, the message and its files were lost. Now the message stays in the chat, stopped, until you send it again, edit it or cancel it.
- The Live Activity showed "Working" after the agent finished its reply. It now stops when the turn
  ends.
- Keep the numbers in a Markdown list in order when you add an item between existing items in the
  message box. Before, the new item and the item below it had the same number.
- A swipe now closes the server list immediately after a swipe opens it. Before, for a short time, the swipe did not close the list, and a touch on the chat list behind it moved or held a chat row.
- A notification, a Live Activity or an app icon quick action now closes the server list when it opens a screen. Before, the screen could open under the open server list.
- On iPhone, agent avatars get their colors back when the server connects again. Before, some avatars stayed gray.
- A hosted server no longer stops soon after it starts while you read it with the app in the foreground. Before, it stopped about 15 minutes after a wake when you did not type. The app in the foreground now keeps it on for at most 30 minutes after your last message, change or typing, or after you open the app again.
- The app keeps starting a hosted server while the server starts. Before, it stopped after 5 minutes.
  It now stops only when the machine runs and OpenBot on it does not connect in 15 minutes.
- On iPhone, a long agent reply shows word by word for one second. Then, if the full reply is available, all its text shows at once, with a strong, a light and a strong knock. Before, the words continued to show one by one for a long time after desktop showed the full reply.
- On Android, a message that waits for the server stays at the right edge of the chat. Before, it moved to the left.
- On Android, file names and code in a reply paragraph align with the text. Before, they were too high, and a long file path was cut at the edge of the message.
- On Android, screens with animations scroll more smoothly. Before, scrolling could stutter after an animated item closed.
- On Android, a share from another app that starts OpenBot shows the share sheet with its Close and Share buttons. Before, the sheet filled the screen and the status bar covered the buttons.
- When you swipe to close the server list, the agent list behind it does not respond. Before, the swipe could pin an agent, open a chat or press the server list button.

## [1.3.1] - 2026-10-14 (Android), 2026-10-15 (iOS)

### Added

- The owner of a hosted server can restart it from Server settings. The app asks before the restart.
  The server stops and starts again, and the app connects again when the server is back.
- Italian interface. Choose Italiano in Settings > App language, or keep System default on an
  iPhone that uses Italian.
- Get a notification when an agent finishes, stops with an error, or needs your input, an approval,
  or a step in the browser while OpenBot is not on screen. It shows the agent name and the start of
  the reply, the question, or the action to approve, and a tap opens the chat. Apple and the OpenBot
  account service cannot read the text. An answer or an error does not come while you use the
  desktop app. While the Live Activity shows, no notification comes: the Live Activity shows the
  event, and with Play sound on it lights up the screen and plays the sound, also with notifications
  off. The server must run an OpenBot version with this change.
- Settings > Notifications now has the notification and Live Activity settings on one screen. It
  turns notifications on or off, hides the reply preview, and sets the one sound of notifications
  and the Live Activity: Play sound on or off, and the OpenBot sound of the desktop app, one of the
  four sounds of the desktop sound themes, or the iOS sound. The app plays a sound when you choose
  it. For each server you can choose all activity, only the events that need you, or nothing, and
  mute the server for a time, as in the desktop app. Server settings have the same choices.
- Sign in with your email and a one-time code, the same as on the web. You no longer need to scan a
  QR code from the desktop app. The app then shows every server that your account can use.

### Changed

- You can choose a default server. Press and hold a server and choose Make default. The default
  server stays at the top of the server list, and the app opens on the first server in the list. So
  you can start on a remote or cloud server instead of your local server. Your local server stays the
  default until you change it.

### Removed

- The app no longer shows channels, with any version of OpenBot on your computer. You cannot make a new channel, and Settings no longer has Deleted channels. Search and the routine calendar show only agents. To make agents work together, put them in one sidebar section.

### Fixed

- Signed-in devices now show a hosted server with its name, as a hosted server. Before, the list
  showed it as "Desktop".
- On Android, the app no longer closes when an agent avatar fades because its computer goes offline or comes back online.

## [1.3.0] - 2026-10-13 (Android), 2026-10-15 (iOS)

### Added

- Visual replies. A chart, a table, a diagram or a mockup that an agent shows as an HTML page on
  the computer appears in the phone chat as its HTML file, with the page title. The phone does not
  run the page. The page does not count as an unread message.
- Report safe categories for error alerts, chat send failures, and failed actions.
- Keep a bounded local error queue and retry on foreground or reconnection. Opt-out and account changes clear pending reports.
- Add a webhook trigger to teammate and group routines. The host makes the webhook URL and the signing secret. You see the secret one time when you create the webhook, and you can make a new one.
- Each routine shows the webhook requests that it ignored. Tap **Filter events** to limit a webhook routine to one event type and to data filters.
- Animations settings. In Settings > Animations, you can turn off all animations, as Reduce Motion
  does. You can also turn off only the zoom into a chat, the agent faces, the compact message
  field, or the reply animation. The Reduce Motion setting of the phone still applies.
- Russian interface. Choose Русский in Settings > App language, or keep System default on an iPhone
  that uses Russian.
- Add Spanish and German to the app language settings.
- Hide the "Waiting for replies" list in the queued messages sheet when every teammate replied or failed.
- Use an agent's browser from your phone. Tap the globe in the chat header to see the agent's tab
  live, or to open a new tab when the agent has none. Your finger moves the pointer from anywhere
  on the screen, as on a trackpad, and a tap clicks at the pointer. Turn off Trackpad mode in the
  ··· menu to click where you tap. One finger drags, two fingers scroll, a pinch zooms, and a tap
  with two fingers or a press and hold right-clicks. The page's menu then opens on your phone, with items
  such as Copy Link and Paste. The pointer shows the page's cursor, such as a hand on a link or a
  bar in a text field. The keyboard button types on the page, and the clipboard button copies
  selected text to your phone and pastes from it. The ? button explains each gesture.
- The arrows in the bottom bar of the browser go to the previous and the next page. Reload page is
  in the ··· menu. The tabs button shows the agent's tabs: select a tab to show it, or open a new
  tab or close the tab on screen.
- The page in the browser keeps the same size on your phone when the window of OpenBot on the
  server changes size. The server needs this version of OpenBot.
- When an agent asks you to take over its browser, the request has an Open browser button. In the
  browser, choose I'm done in the ··· menu to give control back to the agent.
- You can allow or deny an agent's approval request in the chat. The card shows the command, files or permissions, and says what each answer does on the computer. Before, the chat only showed "Waiting for your input on desktop".
- When a request is too long to show on the phone, the card lets you deny it and tells you to open OpenBot on the computer to allow it.
- Mark agents that wait for you in the agent list, with an icon for a question, an approval, or a browser takeover. A "Needs you" group shows them above the sections.
- When an agent waits for you, the compact Dynamic Island shows an amber mark on the agent's photo, and the agent's name has the agent color.
- Mark all agent chats and channels on a server as read from the home screen chat options menu. If a chat cannot be marked read, it stays unread and the app tells you.
- Agent info groups the agent settings as the desktop app does: **Brain**, **Knows**, **Does**, and **Rules**. **Rules** has **Permissions**, **Notifications**, and **Advanced**.
- **Advanced** shows the workspace folder of the agent and can start a **New chat**. A new chat shows a "New chat started" divider in the chat.
- Owners and admins can turn **Computer Use** and **Local scripts** on or off for an agent, and select what a message does while the agent works (**Queue** or **Steer**). A change made on the computer or on another device shows at once. The computer that runs the agent must have the newest OpenBot desktop version.
- Owners and admins can see and delete the **Tables** that the agents share, and **Publish** an agent as a link template. The link preview of a template that you publish from the phone shows the general OpenBot image, not an agent card.
- Support Pi and Muse agents on hosts with Team API v7.
- Add provider session settings and reset on hosts that support this feature.
- Choose which agent memories enter every prompt on updated hosts. Keep other memories saved for search, and let the agent manage the selection when needed.
- Polish interface. Choose Polski in Settings > App language, or keep System default on an iPhone
  that uses Polish.
- Write and send messages while your server is offline. Waiting messages are drawn lighter, one line under them says they send when the server is online, and you touch and hold a message to edit it or not send it. They send on their own when the server is back. The phone keeps waiting messages and their files when you close the app.
- Search finds the same kinds of results as the desktop search: agents, channels, messages, files and routines. It also finds the settings pages of the app and of the server. The filter button next to the search field shows one kind of result. Files show when the computer has the latest OpenBot.
- A search result opens what it names. A message or a file opens the chat at its message. A channel opens the channel, a routine opens its settings, and a settings result opens its page.
- Settings > Animations has "Animate search results". It turns off the blur when search results change.

### Changed

- New Claude agents use Haiku 5.5 by default.
- The screen that creates an agent now has a soft glow in the color of the agent. When you select a different color, the glow and the avatar change to the new color smoothly.
- Settings has no General page. Appearance, Animations, Language, Haptics, Live Activities and
  Privacy each have their own page. Hidden chats and deleted channels are on the Settings page.
- Show what a hosted server gives at the top of the plans sheet: it runs OpenBot 24/7 on an external
  server, keeps agents and routines running when the computer is off, and needs no technical setup.
- Like on desktop, consecutive messages between agents show as one line in the chat, such as "3 messages with 2 agents". Tap it to see each message.
- A message to several agents shows their avatars and the number of agents. Tap it to see their names.
- Explain that Local scripts can also send messages, answer questions, and accept or decline approvals on a supported host.
- Show a specific reason when a connection to a server fails, for example when the host is busy or
  an invitation was already used. Before, most of these failures showed "The connection failed."
- Show a short error code in error alerts, with a "Copy code" button. Send this code when you report
  a problem, so we can find the cause.
- German, Spanish, French, Japanese, Russian and Turkish now translate all screens of the app.
- The app no longer sells cloud servers. Tap + in the server list to see the plans and your cloud servers, with the plan, billing period and state of each server.
- When an agent asks for a password or a code, you type it where the composer is. The value goes only to the browser, not to the chat.
- Browser takeover requests in a chat show as a lighter card, with one main action and a close button to cancel.
- While an agent waits for you in its browser, the chat says so, instead of asking for input on the desktop.
- The chat stays free while a message sends: you can write and send the next one at once. Messages of one chat arrive in the order you sent them.
- A message that did not send stays in the chat as `Not sent`. Touch and hold it to retry, edit it or not send it. Before, its text went back to the composer.
- When the connection drops during a send, the message waits and sends again when the server is back, and the server stores it once. A server that cannot recognize a repeated message marks it `Not confirmed` instead, so you can check the chat first.
- Search results show the agent or channel picture, the time and the words that match. All shows the first results of each kind, and "See all" shows all results of that kind.
- Search results come in, go out and move to their new place with a short animation. Sections of results and search messages come in with a short blur. When motion is reduced, they only fade.

### Fixed

- Voice mode on iOS. The Cancel and Send buttons no longer show as small circles behind the voice
  button while you speak, or behind the composer after the voice mode closes.
- Show the answers that an agent waits for, and the latest channel message, as plain text. Before,
  these previews showed raw Markdown marks such as `**` and `#`.
- A message that you send to a running turn now shows after what the agent did before it. Before, it moved up to the turn's first message.
- Prevent a server connection from closing with “Signal message is invalid” when the browser sends an empty ICE completion marker.
- Keep the connection to your computer when you open the app again while the connection still
  works. Before, each return to the app restarted the connection path, and after 10 restarts the
  computer closed the connection. The app then stopped for a few seconds while it connected again.
- The agent's browser follows the light or dark appearance of the app.
- Live Activity answer buttons show as one capsule each and share the full width.
- The owner of a server can now remove it from the account in server settings, also when its computer is offline or gone. Before, an owner could not remove such a server. The removal applies to all members and all devices. Members lose access, and connected Slack, Discord, Telegram and webhook routes stop. If you add the server again, invite its members again and set up its connections again. Old webhook URLs do not work again.
- Open a chat of an agent on a connected server that is not the active one, for example from a Live Activity, and OpenBot now loads the messages, loads older messages and marks them read on the agent's own server. Before, it asked the active server.
- Report failed browser Live View connections and input as failures instead of normal view termination. Release failed sessions so the view can be opened again.
- Tasks card. The step in progress shows all its lines at each text size. Before, a larger text
  size cut off the bottom of the step, and the next step touched it.
- While an agent works, its activity row in the chat now shows at most two lines of its thinking text, next to the avatar, as on desktop. Before, a long thinking step made the row as tall as all of its text, and most of that text did not show, so the chat showed a large empty space with the avatar in the middle of it.
- The activity row now stays from when you send a message until the reply shows. Before, on Android, the row could disappear and show again while the agent started its work.
- On Android, the activity row no longer shows a black background for a moment when it appears.
- On Android, the bubble of an agent reply now grows with its text. Before, the text could go out of the bubble while the reply showed.
- On Android, the text of a reply no longer flickers while it shows word by word. Each word now shows at once.
- A browser request in a chat stays visible, with the typed value, while Notification Center or another system overlay is open.
- In Settings > Support, the recent log scrolls in its own box, so a long log does not make the page very long.
- After 45 minutes on one server connection, and on each return to the app after that, the app asked the signalling service for new relay credentials many times a second, until the service closed the socket for a minute. A lost connection could not recover in that minute. The app now asks once every 45 minutes.
- A remote connection that Signal refuses for a reason other than a rate limit, such as an invalid ticket, reconnects at once. Before, OpenBot waited 60 seconds as if Signal had limited its rate.
- A server is usable sooner after you return to the app. Before, "Reconnecting" stayed until every chat that you had opened before had loaded again, one after another. Now it ends when the agents and the unread counts load, and the chats load after it, the open chat first.
- After more than 30 seconds away, the app waited 3 seconds for a dead connection before it connected again. Now it repairs the connection at once, or replaces it at once when the server has already dropped it. After more than about 3 minutes away, it shows at once that it connects, instead of a server that looked online but did not answer.
- On a return to the app, the selected server connects first, and your other servers follow when it is online.
- When the server had dropped the connection while the app was in the background, the status showed a short countdown and said that the desktop had restarted. Now it shows that the app connects again, and the message says that the server no longer has the connection.

## [1.2.0] - 2026-10-08

### Added

- In an agent chat on a team, each message from another person stands on the right, with your messages, and shows their name. Their bubble has their own color, so it does not look like yours. Messages sent before this update show as yours.
- Turkish (`tr`) language support in mobile app settings and interfaces.
- Brazilian Portuguese for the iPhone app. Select Português (Brasil) in Settings, or use your phone language.
- More of the iPhone app is in Turkish, including agents, chats, channels, servers and usage.
- Routines for a server. Touch and hold a server in the server list, then select Routines. The week view shows the runs of each day with the agents that do them. Swipe the days to change the week. Select Day in the header to see one day; today also shows the next runs. Select a run to open its routine.
- Buy a cloud server from the iPhone app. Tap + in the server list, choose a plan, and pay on a secure Stripe page. The app shows the setup until the server is ready, and the server shows on your computer too.
- Usage for a server. Touch and hold a server in the server list, then select Usage. The report shows the processed tokens and the estimated cost of all agents on the server, with the share of each agent. Select an agent in the list, or in the Agent row at the top, to see the usage of one agent.
- Settings → Support. It shows how to get help: report a problem on GitHub or message us on X. It also shows a support log of recent app events, connection steps, requests and errors. Select Save log file to save the log or attach it to a message. The log stays on your phone and OpenBot never sends it. It does not record messages or files, and it masks passwords and tokens. Select Clear log to remove it.
- Cursor and Cline agents on a server now show in the app. Before, the server kept them hidden.
- HTML pages and Mermaid diagrams in a reply. A code block marked `html` or `mermaid` shows as a
  card with a header and a small picture of the page or the diagram. Tap the card to open it on its
  own screen. Go back with the back button or a swipe from the left edge. Use the menu in the
  top-right corner to switch between Preview and Code, to wrap long lines of code, or to copy the
  code. Move a diagram with one finger, pinch to zoom, and double-tap to zoom in or to see the
  whole diagram. A page runs no scripts and loads nothing from the network.
- Buy a cloud server from the Android app, version 1.1.0. Tap + in the server list and choose a plan.

### Changed

- A routine run in a chat shows as one short line with the routine name and its state. The chat no
  longer shows the routine instruction as your message.
- The routine schedule is easier to set. Select how often it repeats (hourly, daily, weekly, monthly or yearly), then the days and the time, as on desktop. A cron expression is now the last choice, for advanced schedules only.
- The OpenBot logo no longer turns when you turn your phone, and the app no longer uses motion access.
- Settings → About shows the build number after the version, such as "1.1.0 (17)".
- The agent Usage page has a clearer period control. Select 7 days, 30 days, 90 days, 1 year or Custom. For Custom, set the start and end dates with the date pickers. The report changes at once. The daily chart is now the chart of the desktop app: one area for each provider, in its color, with the values on a grid. Touch or drag across the chart to see a day, with the value of each provider under it. When you change the period or the agent, the report stays on screen and its numbers and chart move to the new values.
- On Android, the app no longer asks for access to all photos and videos. You still choose photos and files with the system picker, and you can still save images from a chat.
- The microphone in a chat now opens a voice mode. The composer becomes one round button in the
  centre, the chat goes darker with a blur from the edges, and a glow in the agent's colours follows
  your voice. Your words come in one by one at the top of the screen. Press the button to stop, then
  choose Cancel, Continue or Send. Before, dictation put the words into the message field.
- On Android, sheets have rounded top corners, as on iPhone.
- On Android, content in a sheet fades below the header and does not stop at a hard line.
- A server with no agents shows animated characters around an Add agent button in the center of the screen. Before, it showed a small icon and a plain button.

### Fixed

- Opening a chat with unread messages marks them read. Before, the unread dot stayed until you
  scrolled to the bottom when the chat opened in the middle of its history.
- Keep the connection to your desktop when the phone changes between Wi-Fi and mobile data, or
  loses mobile data for a short time. Before, the app made a new connection after 5 seconds,
  waited 10 seconds between attempts, and waited 2 minutes after 5 failed attempts.
- Reconnect as soon as the phone gets a network again, not at the next planned attempt.
- Keep a new connection over a slow mobile network. Before, the first check of the desktop stopped
  after 3 seconds and started the connection again.
- The iPhone app now shows the year on a date that is not from the current year. Before, a message from last year and one from this month could show the same day and month, and the list could not be read by recency.
- The app no longer stops at start with "Cannot find native module 'ExpoWidgets'" in a build without Live Activities. It opens without them.
- When you ask an agent to create a routine from the iPhone app, the routine now runs in the
  phone's timezone. Before, it ran in the server's timezone. The server must be updated too.
- A long press on a server in the server list keeps the list open while the menu shows.
- On Android, the areas behind the status bar and the navigation bar now use the app background color, not a light color.
- On Android, sheets now show their Save, Close, Add and Copy buttons.
- On Android, sheet headers no longer have extra space above the title.
- On Android, a downward drag in a sheet scrolls the list before it closes the sheet.
- On Android, a long press on an agent shows all of the agent actions, as on iPhone.
- On Android, the agent search has one background color.
- On Android, choices such as Theme, Language, routine Repeat and Day, model, access and member role open a menu, and the switches in Settings → General are easier to read.
- On Android, the home header has the same color as the list.
- On Android, the app now fills the screen from the top edge to the bottom edge, behind the status bar and the navigation bar.
- On Android, a long press on a server in the server list opens its options.
- On Android, a downward drag on a short list in a sheet, such as the search results, closes the sheet.
- On Android, the loading animation no longer stays over the app after loading ends.
- On Android, the header over the invitation scanner in the Cloud server sheet is transparent, as on iPhone.
- On Android, the name of a pinned agent or channel is cut to its column.
- On Android, the agent search keeps the results below the search field when the keyboard opens.
- On Android, the keyboard opens when the New section sheet opens.
- On Android, a file that the app cannot read with the file API can still be attached to a message.
- On Android, the agent choice on the server Usage screen opens a menu, as the other choices in the app do.
- On Android, pinned agents and channels with a long title took too much space, and their titles were not shortened. Each pinned item now stays in its column.
- On Android, the numbers in the "Reconnecting" status flickered when they changed. They now fade smoothly from one value to the next.
- The "Reconnecting" countdown showed 0:00 at the start of each attempt and then jumped to the wait. It now shows the wait from the start of the attempt, and it appears together with the status.
- Android sheets no longer show a blur at the top edge. All sheets now look the same.
- The server Usage sheet on Android no longer has extra empty space above its title.
- On Android, the sheet that adds a shared agent from a link shows its title, Close and Add agent buttons.
- On Android, the Create an agent, New channel, New section and Actions needed sheets show their title, Close and Create or Save buttons.
- On Android, the app no longer closes with an error when you save in a sheet.
- On Android, agent and channel rows in the home list were wider than the screen. Long text was not shortened, and the time of the last message was not aligned or not visible. Each row now fits the screen.
- On iPhone, the home screen of a server with no agents does not scroll. Before, you could drag it up and down.
- The home list now blurs below the header when you scroll, as the chat does, on iOS and Android.
- On Android, the home header is no longer an opaque bar that cuts the top row of the list.

## [1.1.0] - 2026-09-29

### Added

- Choose the app language in Settings > General: System default, English, French or Japanese. Text
  that has no French or Japanese translation yet shows in English.
- Search agents and the messages in their chats on the connected computer. Search and add are two
  separate buttons on the home screen.
- An agent plan shows as a task list, as on desktop: a card that opens and closes, with the state of
  each step and a spinner on the step that runs.
- A file name in inline code, such as `package.json`, shows a type badge and the color of its file
  type, as on desktop.
- A failed message shows the reason below it. When the computer gives no clear reason, the app
  tells you to send the message again.
- Owners and admins can set the access of an agent (Workspace only or Full access) and Auto approve
  on the Runtime page of the agent. Full access asks for confirmation first.
- Owners and admins can change the server name and logo in Server options. The server list shows the
  logo.
- Haptic feedback when you open and close screens, pick options, save, and when an action succeeds
  or fails. Turn it off with the Haptics setting.
- Open a shared agent link (`https://openbot.run/agents/...` or `openbot://agents/...`) in the app.
  You see the agent before you add it, and you choose the server where you are owner or admin.
  Before, the link opened Safari or showed "Link unavailable".
- Manage the skills of an agent from Agent info > Skills. An owner or admin can turn a skill on or
  off and uninstall it. A folder skill stays read-only, and a member sees only the list.
- Create a skill from Agent info > Skills. An owner or admin taps +, and the app puts the request
  in the agent chat. The agent then asks what the skill is for.
- The skill list updates by itself when a skill changes on the computer or on another device. The
  computer must run a version that sends these updates.
- Chat messages show LaTeX math as formulas. Write inline math as `$...$` or `\(...\)`, and display
  math as `$$...$$`, `\[...\]` or a `math` code block. A formula that does not parse shows its
  source.
- Turn off the agent color on your messages in Settings > General > Appearance. Your messages then
  use the neutral color. The setting is on by default.
- The message box continues a Markdown list. Press Return after a `- `, `* ` or `1. ` item to start the next item. Press Return on an empty item to end the list.
- When you open a hosted server that stopped after it was not in use, the app starts it again and connects when it is ready.
- The Lock Screen and the Dynamic Island show what your agents do, as the desktop Dynamic Island
  does: work, new replies, questions, approvals, browser steps, and failed tasks. You can answer an
  approval or a short question from the Lock Screen. OpenBot asks again before it approves a command.
  When several agents have new replies, the activity lists them. Settings > General > Live Activities
  turns this off. When iOS stops OpenBot in the background, the host keeps the activity current
  through Apple. The update is encrypted for your phone, so Apple and OpenBot cannot read it.

### Changed

- The question form of an agent has no text field of its own. Tap "Reply in the chat", and your next
  message from the composer is the answer. A private answer still uses its own masked field.
- An answer from a teammate agent shows under "Waiting for replies" in the queue sheet, and not as a
  queued message that you can edit, steer or move. The computer must run a version that sends this
  information.
- Server members shows how many members the server has of its limit, for example "1 of 3 members".
  When the server is full, you cannot create an invitation until you remove a member.

### Fixed

- The highlight of the selected server fills the full row in the server list. Before, it stopped at
  the end of the server name.
- Search shows only results from your computer. Before, it showed sample English results.
- Chat previews and search results show message text without Markdown marks such as `**`.
- The keyboard closes when you leave a chat with the back button or a swipe. Before, the keyboard
  stayed open over the agent list, and you could not close it.
- Long inline code in a chat message breaks across lines. Before, the code wrapped inside its box
  and covered the line above.

## [1.0.0] - 2026-09-28

### Added

- First mobile release.
