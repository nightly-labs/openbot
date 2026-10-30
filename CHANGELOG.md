# Changelog

All notable changes to OpenBot will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md).

## [Unreleased]

## [0.54.0] - 2026-10-29

### Added

- A Workspace only agent can now change files in folders that you add. Open the agent's settings, then Folders, or drop a folder on the chat. The agent knows which folders it can change.
- You can set the context window of each model of a custom provider on this computer. OpenCode then compacts the conversation at the correct size, and does not use its 200K-token default.
- Ctrl+F (⌘F on macOS) now searches the open side thread. Before, the shortcut did nothing in a side thread.
- The website has a Pricing page. It shows the hosted servers at their Stripe prices, the Starter
  license (1 member) and the Team license (2 to 10 members), monthly or yearly, in EUR, USD or PLN.
  Choose a server, a license or both. The summary shows the total. Visitors in the EU see that the
  prices do not include VAT. A license bought with a server costs 10% less (bundle discount), and yearly
  billing takes 20% off a license. When the Stripe prices do not load, the page shows the list prices.
- The header and the footer of the website have a Pricing link.
- The Pricing page has one button. It opens the web app at the add server dialog, or at Billing
  when you choose only a license.

### Changed

- An agent's post to Slack, Discord or Telegram now gives the agent the ID of the post, and for
  Discord a link to it, so the agent can link to the post.
- A new server has fewer members: Starter 1, Standard 5 and Pro 10. Servers that already exist keep
  their limits (Starter 3, Standard 10, Pro 25).
- Sell the commercial license in two plans. Starter is €10 a month for 1 user. Team is €25 a month
  for 2 users and €15 for each extra user, up to 10. For more than 10 users, contact us. Yearly
  billing takes 20% off. An account that pays for a hosted server (any plan) then pays 10% less for
  the license. Each user can use up to 3 devices.
- On the Pricing page, set more than 10 members for the Team license to see the custom price and a
  Contact us button.
- Add server lets an account with no license choose personal or work use. For work, set the people
  at work, and buy the server and its license at the bundle price with one payment.
  The license cannot have fewer users than the people who use your servers now, and the order uses
  the currency of your other plans.
- Buy a license alone from Billing: set the people with a slider and see the price at once.
- Change a Starter license to Team, or a monthly Team license to yearly, from Billing. When an
  invite needs more than 1 user, the members section offers the change to Team.
- Make a new commercial license free until 1 December 2026. Billing, Add server and the pricing page
  show "Free until 1 December 2026". Stripe takes the first payment on that day. Cancel before then
  to pay nothing.
- The pricing page sends its order to the web app. After sign-in, the app goes straight to Stripe
  Checkout with the same server, license, users, billing period and currency, so you do not choose
  again. When the order does not fit the account, such as another currency than your other plans,
  the app shows the order filled in and you confirm it.
- Update the Privacy Policy, Terms & Conditions and Commercial License Agreement on openbot.run.
  Add the Data Processing Addendum at openbot.run/dpa. openbot.run/privacy shows the Privacy Policy too.
  openbot.run/commerciallicense and openbot.run/branding open the existing pages.
- The site footer links to the Terms, the Commercial License Agreement and the DPA.
- When you add a server for work, the dialog now tells you why it does not let you choose fewer people: everyone who uses your servers now needs a seat on the license.
- Prices in PLN are 4 times the EUR price, so they are round amounts. The Starter license costs 40 zł a month, and the Team license costs 100 zł a month for 2 users and 60 zł for each extra user. A new hosted server costs 80 zł (Starter), 200 zł (Standard) or 400 zł (Pro) a month, not 90, 220 or 440 zł.

### Fixed

- OpenBot starts on a Mac where `/Library/Application Support` or `/Library/Application Support/OpenBot`
  has a non-root owner or group write permission, and no host manager is installed. Before, OpenBot
  stopped at each start with an empty error. A start error from the host manager check now shows its
  cause.
- Remote desktop pairing on macOS 27 works again. Before, the host stopped at each pairing attempt and every setup check showed as not checked.
- When an agent cannot open a secure password or code card for a sign-in, it now gets the reason,
  such as which field or button target is wrong, and can correct the request. Before, it got only
  "Secure authentication is unavailable".
- Routine agents now check saved Vault logins before they report a sign-in requirement. They can use saved passwords and authenticator codes through secure browser input.
- Quit OpenBot without the error "OpenBot database is not initialized." when an agent reports its
  context use during the quit.
- Keep a self-hosted or hosted server responsive after an error in the main process, and let it
  finish a quit. Before, an error box that nobody could close on the server display stopped the
  process, and the service manager did not start it again. On desktop, an error during a quit also
  shows no error box.
- OpenBot keeps working when a page in the browser requests an address that it cannot read, such as a host that starts with an escaped space. Before, OpenBot stopped and did not answer until a restart.
- Show the reason of a group chat task that stopped because its member was removed or is not
  available in your language. Before, the reason was always in English.
- Show only Reassign on a stopped group chat task whose member left the group chat. Before,
  Continue stopped the task again.
- Provider settings in agent settings show in one card, as the other groups do. Before, each switch showed under its name and each choice was a full-width field outside a card.
- Keep a new provider account, such as another Gemini account, when its sign-in works but its first
  usage reading fails. Before, OpenBot removed the account after the Google sign-in, so it looked as
  if OpenBot did not add the account. A Reconnect with the same failure now shows the account as
  connected, not as an error.
- Keep the chat steady when you switch between agents that have queued messages. Before, the queue
  animated the other agent's messages out and this agent's messages in, and the chat jumped while
  the queue changed height. When the agent that you open has no queued messages, the queue of the
  other agent now closes at once.
- Let Gemini continue when one MCP server that OpenBot gives it does not start, such as a server that asks for a sign-in. Before, each Gemini turn failed with "The MCP server '<name>' failed to initialize". Now OpenBot leaves the server out, tells you which server it left out, and sends the message again.
- Cancel and × now stop a browser sign-in in the Apps connect dialog. Before, both stayed off while the dialog waited for the browser, for up to 5 minutes.
- Show the agent's steps in a side thread, as in the agent's own chat: the thinking while the agent
  works, and the steps row above each answer. Before, a side thread showed only the answer.
- On macOS, **OpenBot → Check for Updates…** opens Settings on the Updates tab, where the check and its
  result show. Before, nothing changed on screen when OpenBot was up to date or the check failed.
- Check the remote desktop permissions when you open Server settings → Remote desktop on a Mac.
  Hide the Grant button of a permission that is already allowed. Before, all rows showed
  "Not checked" and Grant until you selected Check again.
- Cursor turns fail less often with "Invalid model value". Cursor asks its server for the model
  list each time the model is set, and reports a failed request as an invalid model. OpenBot now
  sets the Cursor model only when it changes, not before every turn (#3800).
- An agent that a ChatGPT (Codex) usage limit moved to a backup model now goes back to its model within 15 minutes when Codex ends the limit early, for example after you spend a reset credit in the Codex app. Before, OpenBot kept the agent on the backup model until the old reset time, also when you selected the model again.

## [0.53.2] - 2026-10-28

### Added

- Agents now save lasting preferences and facts from your chats and side threads in the
  background. After every 20 turns, after 15 minutes with no new turn, when you clear a chat and when
  you close a side thread, the agent's provider reviews the new part of the conversation and adds,
  updates or forgets memories. The conversation shows the changes. Memories that you wrote or set
  stay as they are.
- Agents now search their saved memories before they say that they do not know something about you.
  A search also finds other forms of a word, so "closing" finds "closes".
- A memory review uses the provider's smaller default model when the agent's model costs more, such
  as Claude Haiku for an agent on Opus or Sonnet.
- Server settings > General > Memory review sets how often the agents on a server review their
  memories: every 10, 20 or 40 turns, or Off. Off also stops the reviews after a pause, a clear and a
  closed side thread. An owner or admin can set it for this computer and for a joined, hosted or
  self-hosted server that runs this release.

### Changed

- An agent can now keep 256 memories by default instead of 64, so the background reviews have room
  for many small facts. Only the essential memories go into each prompt, so this adds no cost. A
  limit that you set in Server settings > General > Memories per agent stays as it is.

### Fixed

- On Windows, OpenBot updates again when it was installed in `%USERPROFILE%\OpenBot`, the folder that
  also holds your agent folders. Before, each update stopped with "Failed to uninstall old application
  files. Please try running the installer again.: 2", also after a restart. The update now installs
  OpenBot in `%LOCALAPPDATA%\Programs\OpenBot` and removes only the app files from the earlier folder.
  Your agents, `Shared` and `Downloads` stay where they are. **A taskbar pin of the earlier copy stops
  working: pin OpenBot again from the Start menu.** The Start menu and desktop shortcuts, the
  openbot:// links and the open-at-login setting move to the new copy. **Do not uninstall OpenBot from Windows
  Settings to repair this: in that folder, the uninstaller of 0.53.1 or earlier also deletes your
  agent folders.**
- The Windows installer no longer accepts `%USERPROFILE%\OpenBot`, `%APPDATA%\OpenBot`, or a folder
  that holds one of them, as the install folder. It uses the default folder instead.

## [0.53.1] - 2026-10-28

### Changed

- Server settings › Storage no longer shows the disk, memory and CPU use of the machine or its alert
  levels. OpenBot no longer sends machine alerts and does not show the machine card in the sidebar.

### Fixed

- While a question, approval or browser request waits for you, the activity line under the chat now
  says that the agent waits for your answer, your approval or you in the browser. Before, it kept the
  last tool step, such as "Working through the next tool-assisted step…".
- A message that you send with a Markdown table is now as wide as an agent table. Before, the message stayed 420px wide, and the table broke names and dates in the middle. In a narrow window, the table scrolls sideways.
- The model picker shows the Gemini models also when Gemini starts slowly. Before, Gemini had only
  5 seconds to list its models, and the picker showed "No models are available from Gemini" until
  the next refresh.
- Queued messages no longer show Steer for Gemini, OpenCode, Cursor, Cline and custom agents. These
  providers cannot take a message into a running turn, so Steer always failed. The message still
  starts when the turn ends.
- On macOS, the blue Computer Use rim no longer shows on top of the OpenBot window when that window is in front of the agent's window. Before, OpenBot read the windows in the wrong front-to-back order on some macOS versions, and did not cut the rim where the OpenBot window covers it.
- A failed update check, download or install now writes its reason, error code and HTTP status in
  `logs/main/main.log`. Before, the logs showed only `check_failed`, with no reason.
- The activity log in `openbot.db` now records the turn of each `turn.completed` event and keeps the
  turn of each activity when OpenBot rebuilds a thread. Before, these rows had no turn.
- In a workflow Agent or LLM step, a long model name now stays inside the field and ends with "…".
  Before, the model button went past the right edge of the field. A long agent name next to it
  stays full until the model button has only room for a few letters.
- Agent chats in the sidebar now show their new replies when the app starts before your account
  finishes signing in. Before, the unread counts of those chats were missing after the start.
- A group chat no longer shows its lead as "Working on it…" while the lead is paused. Before, a message that waited for a paused lead showed the lead at work until the user restored it, but the lead did no work.
- Usage now shows an estimated cost for Gemini (Antigravity) turns that use Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet 5.5 or Claude Opus 5.5. Before, these turns had token counts but no cost. The estimate uses the new Gemini rates from the day that Google changes them. Turns from before the upgrade stay without a cost.

## [0.53.0] - 2026-10-28

### Added

- Server settings › Storage shows the disk, memory and CPU use of the computer that runs the server,
  for owners and admins. It updates each minute while it is open.
- Set an alert level for disk, memory and CPU, and choose the owner or admin who gets the alert.
  When the use passes a level, that person gets a notification on each of their computers, and
  again each day while it stays above the level. A server must have this version to use it.
- While a level is passed, owners and admins see a card at the bottom of the sidebar with the use
  and who gets the alert. It opens Server settings › Storage.
- A side thread shows how full its context is next to the send button, as the agent's own chat does.
  Open it to see the details, and select Compact to compact the thread's context now. Compact shows
  for providers that OpenBot can ask to compact, on this computer only.
- A thread that you read on this computer is read on your phone too. The server keeps your read place in each thread for all your devices.
- You can send files in a thread of a joined server and in the web app. The server must have this version of OpenBot.
- Add guides for importing Grok Bot agents and Hermes Agent profiles into OpenBot, with screenshots and instructions for each import method.

### Changed

- The Timezone list in Server Settings has a search field. Type part of a zone, such as "new_york", or its name, such as "Eastern", then use the arrow keys and Enter to choose it.
- When an agent answer names an output file by its full path and does not attach it, OpenBot now attaches the file to the answer. This applies to images, audio, video, ZIP, PDF, office documents, CSV, text and Markdown files of 25 MB or smaller in the agent's workspace or the Shared folder. Before, the iPhone app and other devices showed only the path, and you could not open the file. Code, configuration, log and SVG files, and folders, stay as paths.
- The "Add backup model" list in agent settings has a search field. Type part of a model name, a provider name or a model id, such as "glm" or "openrouter/qwen", then use the arrow keys and Enter to add the model.
- On a sidebar of 300 px or less, the wait chip of a "Needs you" row shows only its icon, so that a long agent name has more space.
- Agent avatars and photo avatars have a thin outline in the colour of the row behind them. In a
  group avatar, the faces are larger and overlap, a photo has the size of the other faces, and each
  outline cuts the face below it. The count of more members is a round disc that overlaps the last
  face. A count of two digits goes under two faces.
- The OpenBot server offer opens as a window only one time: after your first routine on this
  computer. Before, it opened after a new routine on this computer, a remote computer or the web
  app, up to three times. The note above the routine list and the line in the offline notice do
  not change.
- Settings › Mobile Connect shows your phones as cards. "Add phone" opens a short dialog that asks if
  OpenBot is on the phone, then shows only one QR code: the App Store or Google Play code, or the
  sign-in code. A tag under each code says what it does. Before, the tab showed the download code
  and the sign-in code together, and a phone camera could scan the wrong one.
- The permanent link is a card among your phones. Its code opens in a dialog with a warning, and
  hides after one minute. Replace and revoke are in its menu.
- "How devices connect" is a button in the tab header that opens both choices.

### Fixed

- Sliders, such as the Dynamic Island width and height in Settings, move again with the pointer and
  the arrow keys. Before, they did not move.
- OpenBot starts after an upgrade when its database has broken links between rows from an earlier
  version. Before, the upgrade stopped at each start with "OpenBot database migration to version 47
  failed", and the app did not open. OpenBot keeps these rows as they are, and an upgrade step stops
  only when it breaks a link itself.
- A custom provider on an Azure OpenAI or Azure AI Foundry v1 endpoint
  (`https://<resource>.openai.azure.com/openai/v1`) runs agent turns in OpenCode. Before, each turn
  failed with "Function tools with reasoning_effort are not supported".
- The `$` list in an agent thread shows the agent's skills and MCP servers. Before, it said "This agent has no skills.", and a skill in a sent thread message showed as unavailable.
- You can paste, drop or pick images and files in a side thread of an agent on this computer, and they go with the thread message. Before, a pasted image in a thread made a sound but went to the draft of the agent's main chat. A thread of an agent on another computer takes text only, and now says so.
- A chat in "Needs you" shows the question or the command as its preview. Before, it showed the previous message, and the question was only in the tooltip.
- On a server that you joined, a tab that you open in an agent's browser panel opens in the agent's
  browser profile. Before, the tab opened in the shared profile, so a sign-in there was available to
  other agents.
- When an agent asks a question in a thread, the thread now shows the question card and waits for your answer. Before, the question showed only as text, and you could not answer it.
- While a side thread waits for your answer to a question or an API key request, the thread and its tab now show that it waits for you. Before, they showed that the agent worked.
- When a side thread's agent asks you to take over the browser, the thread and its tab now show that the thread waits for you. Before, they showed that the agent worked.
- When your answer or approval in a side thread fails, the error now shows where you answered. Before, it showed in the agent's own chat.
- In the web app, and on a computer joined to a server, a side thread now shows the API key card and the other question forms. Before, it showed only a plain question. The server must also run this version.
- On Windows and macOS, OpenBot now opens the Google sign-in page for Gemini, as it does on Linux.
  Before, the Gemini server opened it itself, and when no page opened, Connect showed no error and
  waited ten minutes.
- When the Gemini process stops answering, OpenBot now ends it and starts a new one. Before, a turn
  could wait with no end, and Gemini worked again only after you restarted it.
- The channel header shows the face of each member. Before, the faces were almost on top of each
  other, so the header showed only one face.
- When an MCP server that you added in Server settings needs a sign-in, the agent now shows the Sign in card in the conversation. Before, the card showed only for a server that the agent added.
- In Discord, the agent now gets the text and files of a forwarded message, when you reply to the forward or mention OpenBot after it. Before, the agent got only your mention and said that it saw no report. When Discord does not give the forwarded content, the agent is told so.
- The activity line of an agent that uses the built-in browser now says what the step does, such as opening, reading, clicking or typing on a web page. Before, each browser step showed "Searching for current information…" and "Reviewing the sources and information I found…".
- About 30 seconds after iOS puts the OpenBot app to sleep, a server now updates the iPhone Live Activity
  and Dynamic Island, and sends notifications. Before, when the app went to sleep before it told the
  server, the activity could show "Working" for more than two minutes after the agent finished, and
  notifications for that time did not come.
- An agent on a second provider account uses that account when it routes group work, makes a group
  summary, answers a side question, or writes its profile. Before, these requests used the
  provider's first account. When the first account was at its usage limit, a group lead on the
  second account stopped with a usage limit notice, and the usage limit card did not offer its model.
- A chat with unread messages now keeps the "NEW" divider in view while its images and previews load. Before, content that loaded after the chat opened moved the divider down, and the chat showed older messages.
- On Windows, Remote Desktop starts again. The remote desktop runtime did not include the Sunshine
  DirectX shaders, so Sunshine did not start and OpenBot showed "Sunshine did not start on the host".
- On macOS, the name of the image in the image viewer no longer shows under the window controls. Before, the first letters of the name were behind the close, minimize and zoom buttons.
- On macOS, OpenBot can now ask for Automation access, so the Apple apps and Messages tools work in
  the released app. Before, macOS refused the request without a prompt, and a Messages lookup
  stopped with `bootstrapTimedOut`.
- When Gemini starts slowly after its first download, as on an Intel Mac, OpenBot now keeps the
  download and tries again, and waits twice as long at each try. Before, OpenBot deleted Gemini
  after 3 minutes, and each Retry downloaded it again and failed the same way.
- After you clicked a channel in the sidebar and then went back to the OpenBot window, the avatars on that row moved without stop, also when the agents were idle. Now they move only while the pointer or the keyboard focus is on the row.
- On a computer joined to a server, the chat of the server's agent now shows the context window meter beside the microphone. Before, the meter was missing. The server must also run this version.
- Start OpenBot when a saved MCP server has headers or other values that it cannot read. Before, the
  app did not open until the server was deleted from the database. Now Server settings shows that
  server turned off, and you can correct it or remove it there.
- When an agent started a new ChatGPT session, for example after it moved to a backup model, the chat
  could show a red `paginated_threads is not supported yet` error. ChatGPT cannot read a session
  before it saves the first turn, and OpenBot now does not show this as an error.
- Show the Download button for an image attached in a side thread, under the image and in the image
  viewer. Before, only the agent's main chat had it.
- Show the Download button for an image file that an agent message names by its path, under the
  message and in the image viewer. Before, only an attached image had it.
- Usage now shows an estimated cost for Codex turns that use GPT-6.1 Terra. Before, these turns had token counts but no cost. Turns from before the upgrade stay without a cost.
- An MCP server that refuses to register OpenBot, such as Dropbox, now shows **Refused** and says
  that the server does not accept OpenBot as an app. Before, it showed **Failed** with the
  server's own text.
- An agent can attach files in the built-in browser when the page opens its file chooser from a
  button, such as the "Paste, drop, or click to add files" button in a GitHub comment. Before,
  `upload_files` worked only on a file input, and on these pages it stopped with "Node is not a file
  input element".
- A channel no longer stops all work when a member repeats its result as its last reply. Before, that reply could stay "still arriving" after the turn ended, and every later assignment in the channel failed with "The provider could not start this assignment". A channel that this blocked works again when OpenBot starts after the upgrade.
- A second Gemini account stays after its Google sign-in when Gemini starts slowly, as it can on Windows. Before, OpenBot stopped the check after the sign-in at 30 seconds, and the new account disappeared.
- When a new provider account cannot sign in, OpenBot now shows an error with the reason. Before, the account disappeared with no message.
- Cancel on a provider account that is still connecting no longer waits until the provider finishes starting.

## [0.52.1] - 2026-10-27

### Added

- Remove the downloaded CLI of a provider that is off. Open the provider in Settings > Providers and
  select Remove download. It shows the space it frees. Accounts, sign-ins and agents stay. When you
  turn the provider on again, OpenBot downloads the CLI again (#3321).
- An owner or admin can import a CSV password export into a server's Vault from the iPhone app.
  The server answers only how many logins it added and skipped.
- An owner or admin can set the default provider of a server from the phone. The server starts new
  agents on that provider. Clients older than Team API protocol 8 do not see DeepSeek, OpenRouter or
  Inception as the default.
- The Apple apps listing in the Marketplace has a switch that asks macOS for access to Calendar, Contacts, Mail, Notes, Reminders, Messages and Safari when you install it. macOS shows one prompt for each app, so the prompts no longer stop an agent in the middle of a task. After the install, "Ask for access" asks again, and a message names each app that macOS did not allow. macOS only.
- The Vault keeps API keys. Add a key with its variable name, such as `OPENAI_API_KEY`, in Server
  settings › Vault › New item › API key. Every agent on the server finds it with `list_api_keys` and
  reads it from a private file in its commands, so the key does not go into the chat. Only the user
  can add, change or delete a Vault API key. An owner or admin of a joined server can manage its API
  keys from the desktop app or the web app when the server has this version.

### Changed

- Agents get shorter instructions, with each rule in one place, so each turn uses less context.

### Fixed

- Show Mermaid diagrams that have a line break in a label. Before, the chat showed a broken image.
- The secure password card now always shows "Save to Vault" and names the Vault: this computer or the joined server. An owner or admin of a joined server can save the password to that server's Vault; the box starts unchecked. A member, or a server that needs an update, sees why the box is off. Before, the option did not show on a joined server or in the web app, and the password was not saved.
- While an agent writes, the activity line shows its text without Markdown marks such as `**` and `- `.
- Start Claude agents as new sessions when a Claude Code session opens OpenBot, for example with
  `open -a OpenBot`. Before, the agents got the session ID, entry point and messaging token of that
  session, and each new chat wrote its prompt cache again.
- Let Gemini start MCP servers whose command, such as `node`, is on the login shell PATH. Before, OpenBot opened from the Dock or a login item could not find the command.
- OpenBot now quits when a file operation never finishes, for example when macOS waits for a privacy
  approval that nobody answers. It stops itself at most 10 seconds after its shutdown, which can take
  up to 30 seconds. Before, OpenBot stopped responding after you quit it, and it did not open again
  until you forced it to quit on macOS or ended it on Linux.
- Agents now follow a confirmation rule in any `CLAUDE.md` or `AGENTS.md` file, also when a request
  names the action. Before, an agent could make a change that cannot be undone, such as a Stripe
  setting, without the confirmation that the file asked for.
- When an agent asks for a password, a code, or browser control in a thread, the thread now shows the card. Before, the card did not show, and the agent waited without end.
- An OpenCode agent's answer after a background subagent ends now shows in the chat. Before, OpenCode saved the answer, but the chat never showed it, because no message had started that turn.
- An OpenCode answer that the agent writes in two steps now shows as two paragraphs. Before, the text of the two steps showed as one line.
- Text that you type in a side thread and do not send now stays in the message box of that thread. It stays when a turn in another thread of the agent ends, when you open another thread or chat and come back, and after a restart. Before, the text was removed when a turn of the agent ended.
- Connect Railway works again. OpenBot now registers as a public client when the sign-in server
  supports it. Before, Railway refused the client secret that it gave, and the sign-in stopped with
  "Existing OAuth client information is required when exchanging an authorization code".
- Show a clear message when a sign-in server refuses OpenBot at the end of an MCP sign-in. Before,
  the message did not say what went wrong.
- When this computer's server was published, OpenBot publishes it again after a start, also when the
  account service or Signal does not answer at first, for example at login before the network is
  ready. It also publishes the server again when Signal disconnects it later. It tries again after
  1 minute, and then less frequently. Before, the server stayed private after one failed try, and
  you had to publish it again, for example after an update.
- A long context compaction with Codex or Pi now runs to its end. Before, OpenBot stopped each
  compaction after 2 minutes, so the compaction of a long thread did not complete. OpenBot now stops
  a compaction only when the provider does not start it in 2 minutes, or when it runs for 20 minutes.
- When Gemini or another ACP agent crashes, the error now shows the first line of the crash report,
  such as `F… Check failed: …` or `*** SIGABRT received …`. Before, it showed only the last line,
  `RAW: Raising signal 6`, which does not say why the agent stopped.
- End a Remote Control session when its stream fails and you go back to OpenBot. Before, the session stayed open, and the Remote Control button showed a green dot on every agent of that server.

## [0.52.0] - 2026-10-27

### Added

- Add Obsidian to the Apps catalog. Agents can search, read and write the notes in an Obsidian vault,
  so the vault can be their memory. Install the Local REST API plugin in Obsidian, turn on its HTTP
  server, and type its API key in the connect dialog.
- Add Neon, Prisma, Netlify, Railway, Atlassian (Jira and Confluence), Todoist and Hugging Face to the Apps catalog. Sign in in the browser to connect each of them, except Hugging Face: it reads public Hub data and needs no account. Neon, Prisma, Netlify, Railway, Atlassian and Todoist give agents write access, so agents can change or delete data there. Each listing says what agents can change.
- The website has the OpenBot Commercial License Agreement at openbot.run/commercial-license. The
  Terms & Conditions link to it.
- Give an agent more than one conversation. Click + in the chat header to start a new thread. Each thread has its own tab
  and runs at the same time as the other threads of the agent. The agent keeps its main chat.
- Rename, close, archive and delete threads from the tab menu. An archived thread moves to "Archived" in the thread
  list, and opening it restores it. Delete shows an Undo button for some seconds first.
- Use threads in the web app and on a computer that is joined to a server, when the server has this version.
- Search on this computer also finds messages in open threads. Select a result to open its thread tab.
- A notification from a thread opens that thread's tab.
- An image file that an agent names in its answer, such as a PNG or SVG in the shared folder, now
  shows as a preview under the answer. Click it to open it at full size.
- Right-click an agent in the sidebar and choose "New thread" to open its chat with a new thread.
- Attach MP4 videos in chat. The chat plays them, and the agent gets the original file. A remote host
  must run this version of OpenBot to accept MP4 files.
- Add Render to the Apps catalog. Connect it with a Render API key. Agents can list workspaces and services, read
  logs, events and metrics, find why a deploy failed, trigger deploys, and run read-only SQL on Render Postgres. The
  key reaches every workspace of the account, so agents can also create services and databases and replace the
  environment variables of a service. The server cannot delete a resource.
- An owner or admin of a joined server can now open that server's Vault in Server settings, in the web app and in the desktop app. They can add, change and delete logins, cards and contact info, and show or copy a saved password, card number or security code. A CSV import is available only on the server's own computer. Before, the Vault showed only for this computer, so the web app had no Vault.
- Add Trello to the Apps catalog. Sign in to Trello in the browser and choose the workspaces. Agents can search and
  read boards, lists, cards, checklists and comments, create boards and cards, move lists and cards, and mark cards
  done. They can also read and add cards in your Trello Inbox and read your Planner events. Agents have the same permissions as you in the workspaces that you choose. They can archive cards and lists,
  but the server cannot delete anything permanently.
- Dutch interface. Choose Nederlands in Settings > General > Language, or keep System default on a
  computer that uses Dutch. The web client uses it too.

### Changed

- Update the Terms & Conditions on openbot.run/terms. They now describe free non-commercial use,
  Commercial Licenses (Starter and Team seats), hosted server plans, the refund and withdrawal rules,
  30-day hosted server data retention after expiry, and Marketplace content reports. The minimum
  age is now 16.
- Change the minimum age in the Privacy Policy to 16, the same as the Terms & Conditions.
- In the web client, the Marketplace now opens as a full page of the window, as in the desktop app. Before, it opened as a dialog over the workspace.
- The Marketplace now has a side panel, as the settings page has. Select Apps, Agents or Skills there. Below them, "Your apps" lists the apps that you connected, and a warning shows on an app that needs your attention. While you search, the panel shows how many results each kind has.
- The Marketplace now opens on Apps. Apps show in groups by category, in compact rows with Connect, Connected or Reconnect at the end of the row.
- To add your own MCP server, click "Add custom" next to the search on the Apps page of the Marketplace. Server settings open on the form for a new MCP server. Only a user who can add MCP servers to the server sees the button.
- On an app, agent or skill page of the Marketplace, the top row now shows the path to it, for example "Apps › GitHub". Click "Apps" to go back to the list. On an app, agent or skill page, Apps, Agents or Skills stays selected in the side panel. On the page of an app in "Your apps", that app is selected. The page has the same width as the list, so the content does not move when it opens.
- Connectors are now only in the Marketplace. Server settings no longer has a Connectors section. To connect or change Slack, Discord, Telegram, GitHub, 1Password or Bitwarden, open Marketplace › Apps.
- All app pages now use one layout: the header, then alerts, then sections with a heading and one card each, and last the danger zone. Text, forms and notes now show inside the cards, and all buttons in a card have the same small size. A plugin that is not completely installed shows a warning above its sections. An app that is not connected now shows "Not connected" at the top of its page. Before, some pages showed "Not set up".
- Slack, Discord and Telegram pages now have a danger zone that disconnects every workspace, server or chat at once, after you confirm. Each row still has its own Disconnect.
- The page that opens after a Slack or Discord sign-in in the browser now tells you to open Marketplace › Apps to try again.
- The connect dialogs of Marketplace apps that you sign in to, give a key to, or turn on in their desktop app now look and work as the GitHub and Slack connect dialogs do. They show OpenBot and the app with a line that moves while they connect, and Cancel and the main button at the bottom right. When a connection fails, the line breaks. Connect in the Marketplace now starts the connection at once: a sign-in opens the browser, and an app on this computer connects if its server is on. An app that needs a key opens with the cursor in the key field.
- To disconnect Bitwarden, use the button in the new danger zone at the bottom of its page.
- The Cloudflare, Airtable and Paper icons in the Marketplace are now centered and clear on a dark background.
- A plugin page now has a Connection section. It shows how each app connects: you are signed in, an API key is saved, it uses a desktop app on this computer, or it needs nothing. Use "Sign in again", "Change key" or "Connect again" there.
- When the sign-in of a plugin expires, the plugin shows "Needs attention" and a warning, and "Sign in again" signs in again. The page header, the Connection row and the Apps list use the same name for this action. A plugin with more than one app shows the button only on the row of the app that needs it.
- Every connector page now has an Information section with the developer, the category and the website.
- On the Slack, Discord and Telegram pages, the sections are now named "Workspaces", "Discord servers" and "Chats". "Add workspace", "Add Discord server" and "Link a chat" are at the right of that section.
- The 1Password and Bitwarden pages now look the same. Bitwarden shows the shared folder and the server address in one card, and the session key field has a label.
- The danger zone of every app page is now named for the app, for example "Disconnect Notion".
- Under the name of Slack, Discord, Telegram, GitHub, 1Password and Bitwarden, the page now shows a short line, as the Apps list does. The full description is at the top of the Information section.
- On the Bitwarden page, the shared folder row now says "Folder in Bitwarden" under the folder name.
- The developer of each catalog app now shows as a name, for example "Notion", not as a web address.
- Tasks are now threads. A task that an agent starts opens as a tab in the chat header, and your existing tasks show
  as threads after the upgrade. Closed tasks show as archived threads. The Tasks page and the task panel are removed.
- "Tasks at once" in the agent settings is now "Parallel threads". "Run as task" on a queued message is now "Run in
  new thread".
- Deleting a thread also deletes its messages and their files from the agent's inbox.
- After this upgrade, an earlier version of OpenBot cannot open your data.
- A message from another agent now steers the running turn when the agent that gets it is set to
  steer busy messages. Before, it always waited in the queue until the turn ended.
- You can steer a teammate's answer into the running turn with Steer in the "Waiting for replies"
  block. Before, the answer waited for the turn to end.
- The iPhone app is on the App Store. Settings > Mobile, the download pages and the changelog page
  link to the App Store, not to the TestFlight beta.
- Messages that you send while an agent works now start one next turn together, in their order.
  Before, each message started its own turn.
- Slack, Discord and Telegram conversations send the agent's messaging guidance and the saved
  facts of the server only in the first turn of a provider session, and again when a fact changes.
  This makes each later turn smaller.
- The agent's name in the chat header opens the agent's main chat while a thread is open. In the main chat it opens
  the agent settings, as before. The main chat no longer has a tab, and the thread list shows only threads.
- Agents get a shorter list of models when they look for a model for a teammate: the default model, the models that agents use, and the first models of each provider. They can search for the other models. This uses less of the agent's context with providers such as OpenRouter that offer hundreds of models.
- In the desktop app, when Cursor uses a merged plan, such as an X subscription, the sidebar shows one usage ring for Grok and Cursor. Before, both rings showed the same shared quota. Hover the Grok ring to see both.
- A server now offers DeepSeek, OpenRouter and Inception, as the computer does. An owner or admin
  saves the provider's API key in the server's provider settings, and the server downloads Pi when
  it needs it. Phones and team members also see agents on these providers. Clients older than Team
  API protocol 8 still do not see them.

### Fixed

- A Cursor agent with Workspace only access on macOS can sign in again. Before, each of its turns stopped with "Cursor did not return an authenticated account." although Cursor was signed in.
- Settings › Profile now says that its activity is the activity on this computer. Before, the title showed only "Activity", also when a different server was open.
- When you save, change or remove a custom model endpoint while an OpenCode task runs, OpenCode now
  restarts after its tasks stop, and the new models show in the model picker. Before, OpenCode kept
  the old models until it stopped for another reason.
- On Windows and Linux, the Alt key no longer shows the menu bar. Before, a single Alt press, or a
  keyboard layout switch with Alt+Shift, moved the page down and took focus from the message input.
  Menu shortcuts work as before.
- Reconnect on a plugin that is already connected no longer fails with "An MCP server named … already exists". It now updates the saved connection.
- A Cursor reply no longer ends with "Error: RetriableError: WritableIterable is closed" after a turn that succeeded.
- When an agent asks another agent from a side thread, the answer now comes back to that side thread. Before, it arrived in the agent's own chat. The request still arrives in the other agent's own chat.
- A side thread now names the other agent as the author of its answer. Before, screen readers read the answer as a message from the thread's own agent.
- A chat with queued messages no longer slows down OpenBot. Before, each queue change wrote the
  queued messages to the database again and sent the whole chat to each connected device, and the
  queued messages went out of the chat and came back.
- Text that you select in a code block of a message shows the selection actions (Quote, Explain,
  Improve). Before, a double-click or a selection in a code block showed no actions.
- OpenBot starts again when an update for a provider CLI is available. Before, the app stopped at start and showed no update notification.
- Muse agents on Windows can start a turn again. Before, each turn failed at once with no reply,
  because OpenBot sent the workspace folders in a form that Muse does not accept.
- A Pi agent keeps its OpenBot tools after OpenBot restarts. Before, a chat that was opened after a restart lost every OpenBot tool, and each restart gave the tools new names, so the agent could call old names and get "Tool ... not found". A Pi chat that already shows this error gets its tools again at its next turn.
- A Pi agent whose session file was moved or deleted starts a new session. Before, each turn stopped with "The Pi session file is not available on this computer."
- A Pi, DeepSeek, Inception or OpenRouter agent with Workspace only access on macOS replies again. Before, each message stopped with "Credential store read failed" and "EPERM", or Pi stopped at the start.
- Edit of a custom provider now shows the names of its saved headers. An empty value keeps the saved value, and you can change or remove one header. Before, the header rows opened empty, so the saved headers looked lost.
- OpenBot no longer offers a CLI update for a provider that is turned off. When you turn the provider on again, the update is offered.
- An answer through OpenCode stays whole when the model streams its reasoning between the words of the answer. Before, the answer was cut at each thought, so the start of a word moved to the steps and words showed in pieces, such as "B aca" for "Baca".
- An SVG path in an agent answer was plain text. It is now a file link that opens the file.
- An agent that tried to attach an SVG file got a general "not supported" error. It now gets told
  to write the file path in its answer, where the chat shows the image.
- The working rings around an agent's face in the activity line of a chat now show in full. Before,
  the edge of the line cut them, most in a channel.
- Go back from a thread to the agent's main chat at once. Before, the main chat was built again, which took about half
  a second and moved it to the top. Now it keeps its place.
- Show the full time of each thread in the thread list. Before, a 12-hour time such as "10:12 AM" stopped after "10:1".
- Close the side panel after you close its last tab. Before, the app stopped responding and the panel stayed open.
- Keep the provider session of a thread when its delete fails and you restore it. Before, the restored thread started a
  new session and lost its thread instructions.
- A message steered into a Claude turn just as the turn ends now shows its answer one time. Before, the answer showed again in the chat after OpenBot started again.
- The browser client at openbot.run/app now shows the custom images of agents. Before, it showed the
  generated avatar for each agent with a custom image.
- An agent with Full access no longer asks before each Computer Use action. Workspace only and Ask
  first agents still ask.
- The usage limit notice in the composer now reads the ChatGPT account that the agent uses. An agent
  on a second account with quota left no longer shows the limit of the first account.
- When you connect or resume Slack, Discord or Telegram on this computer, OpenBot now publishes this computer's server first. Before, the connection failed until you published the server or gave it a name in the server settings.
- A Codex agent no longer says that it could not get an image after it generated the image. Before, the image showed in the chat, but the agent reported a failure and asked the user to try again. Each existing Codex chat starts a new Codex session one time after this update. To edit an image from before the update, attach it again.

## [0.51.1] - 2026-10-26

### Fixed

- On Linux, closing the OpenBot AppImage no longer shows a crash report for `chrome_crashpad_handler`. Before, its crash helper stopped with `SIGBUS` after each quit.
- An agent on a shared server no longer tells you to open the chat on another device to use that device. The agent now says that it works only on the computer that runs the server. Settings › Computer Use also says that agents on another server use that server's computer.
- On a Docker server of `docker/instances` with LXCFS, Gemini works again. Before, it stopped with
  SIGILL when it started, because the container listed only the CPUs of its limit as online.
- On a server, Node programs that Claude agents start now also see the server's CPU limit. Before,
  only Codex and the ACP agents got it, and a build of a Claude agent started a worker for each CPU of
  the host.
- DeepSeek, Inception and OpenRouter now download the Pi CLI when you save their API key. Before, the
  key was saved but the provider showed "The pi CLI is not installed" until you downloaded Pi from
  its own row in Settings.

## [0.51.0] - 2026-10-26

### Added

- Choose the reasoning level of a new agent in the create-an-agent form. The model picker shows the
  level next to the model, as it does in the agent settings. The web app has the same choice.
- Settings › General › "Open external links in" now lists each browser on your Mac, and "Other app…"
  lets you choose an app that is not in the list. On Linux and Windows, "Command…" takes a program
  path or command. Links in chats, sign-in pages, billing pages and connector pages open there. When
  that browser does not start, the page opens in the default browser and OpenBot shows a short
  notice.
- Pin pages to the page rail. The new More button under the rail pages lists Routines, Workflows,
  Tasks, Schedule and Usage. Click a page to open it, or click the pin at the end of its row to show
  it in the rail or take it off. Routines, Tasks and Schedule start in the More menu. The choice is
  saved on this computer, and on the web app in this browser.
- You can change the provider, account or custom agent while a turn or a task runs on this computer. The running work keeps its sessions. The new provider starts before the next turn after the running turn and its tasks end. The header shows the same "After this turn" badge that a model change already uses. On a remote server, a provider change still waits until the work ends.
- Add DeepSeek as a provider. Connect it with a DeepSeek API key, then choose DeepSeek V4 Pro or
  DeepSeek V4.1 Flash for an agent. The agents run in the Pi CLI that OpenBot downloads, and the key
  stays encrypted on this computer.
- A pasted image goes into the message box at the cursor, as a reference with a small preview, its
  name and its size. Thanks to @sebapaszynski.
- When you copy or cut a draft that has attachments and paste it into another agent's message box, the
  files come with the text as new copies. The Copy action on a message also keeps its attachments.
  Other apps get the text with the file names. The clipboard holds no file paths and no file bytes.
- The website has a Brand page at `/brand`. It has the OpenBot logo in each shape and color, with
  and without the name, as SVG and PNG files. "Download all" saves all of them in one zip file.
- Right-click the OpenBot logo in the website header to copy the logo as SVG, download the brand
  files, or open the Brand page.
- Agents use the skills in your `~/.agents/skills` folder with every provider. Claude gets them as `agents:<name>`, and a skill that Claude already reads from `~/.claude/skills` is not added again. Antigravity, Muse and custom ACP agents get a list of these skills in their instructions and read a skill's `SKILL.md` when a task needs it. The other providers already read the folder.
- Type `$` in the message field to tag a skill from `~/.agents/skills`. The agent gets the path of the skill's `SKILL.md`, so every provider can open it.
- You can now zoom into an image in the image viewer of a chat. Pinch, or hold Ctrl or Command and scroll, to zoom around the pointer; double-click to zoom in or back to the whole image; drag or scroll to move a zoomed image. The viewer also has zoom out, zoom in and fit buttons, and the `+`, `-` and `0` keys. Before, you had to download a large image to see its detail.
- Add Apple apps to the Apps catalog. On a Mac, agents can use Mail, Calendar, Contacts, Reminders, Notes, Messages
  and Safari through the community server mcp-icloud. It needs no account or key; macOS asks for Automation access the
  first time an agent uses each app.
- Add OpenRouter as a provider. Connect it with an OpenRouter API key, then choose one of the
  models that OpenRouter serves for an agent. The model picker groups the models by lab and marks
  the free models. The agents run in the Pi CLI that OpenBot downloads, and the key stays encrypted
  on this computer.
- Add Supabase to the Apps catalog. After you sign in to Supabase in the browser, agents can list projects, run SQL,
  read table schemas and logs, check advisors, manage edge functions and branches, and search the Supabase docs.
  Agents get full access, so they can also change data, apply migrations and create or pause projects.

### Changed

- Claude agents use Claude Code's own prompt cache time again by default: 5 minutes with an Anthropic
  API key, and 1 hour for the main chat of a Claude plan within its usage limits. In 0.50.0, OpenBot
  asked for 1 hour for all agents, and a 1-hour cache write costs more. The "Prompt cache" setting on
  the Claude page in Server settings › Providers now has "Claude Code default" and "1 hour". If you
  chose "1 hour", it stays.
- The website FAQ answer to "Is OpenBot open source?" now uses simpler words. It says that all of the source code is public, links to it on GitHub, and says that it is free for noncommercial use. The launch news post now calls OpenBot source-available, not open-source.
- The website header has a Resources menu with Download, Changelog, Community, Documentation, Brand
  and Status. Changelog and the Community button moved into it.
- When OpenBot updates to a new version, it also updates the provider CLIs that it installed, such
  as Claude, OpenCode and Grok, with no update notification. A notification shows only when an
  update fails, with a Retry. A CLI that you installed yourself is not changed.

### Fixed

- A server with a saved Anthropic API key no longer starts a Claude sign-in on the API key account, or
  removes that account, when an older OpenBot version asks for it. That version shows the key as a
  signed-out account. Now it gets a message that tells you to change the key in Server settings ›
  Providers.
- Open and create agent routines in the web app. Before, Create routine and a routine in Schedule
  showed the "This page could not load" error page.
- Show why an OpenCode agent does not answer when the free models reach their usage limit. Before,
  each message failed with no error, and only the agent's face changed.
- Pi agents no longer stop with "Pi returned an invalid RPC record." when a tool call has a value
  such as `true` that is also the value of an MCP server setting or of the GitHub connection. Before,
  OpenBot stopped Pi and started it again, and the turn failed.
- The Cursor usage ring no longer shows an "Other models" window for a Cursor plan that includes no other models, such as an X subscription. It shows the plan's total usage only. Before, it showed an "Other models" window that the plan does not have.
- Escape in the model picker of the create-an-agent form now closes only the picker. Before, it also
  closed the form and the draft was lost.
- In the web app, browser Back and Forward, including the side buttons of a mouse, now open the chats
  that you opened before, also on another server. Before, Back left the app and opened the page that
  you came from.
- On macOS 26 with the Dark icon style, the OpenBot app icon is a black tile with white eyes. Before,
  macOS made a black tile with black eyes, and the eyes were almost invisible. The Light style still
  shows the lavender icon.
- The "Open external links in" setting had no effect, and it went back to "Default browser" after a
  restart. Now OpenBot keeps it, and "OpenBot" opens links in chats in the built-in browser.
- The Linux AppImage starts on Arch Linux, Omarchy and other systems with no libfuse2. It mounts
  itself with `fusermount3` from the `fuse3` package. Before, it stopped with an error about
  `libfuse.so.2`.
- In a wide window, the agent's working row and its pending questions, approvals and other cards now show in the centered chat column. Before, they showed at the left edge of the pane until the turn finished. (#3146)
- Give MCP server tools to Codex agents on GPT-6 and other code-mode models after an update to Codex
  0.164. Before, a chat that started before OpenBot 0.50.0 had no MCP tools. Each Codex agent starts
  one new Codex session to get the tools.
- On Windows, OpenBot now tries again when another program, such as antivirus, has a settings file
  open while OpenBot saves it. Before, a save at sign-in could fail, and then Slack, Discord and
  Telegram connections failed with "Sign in, give this computer a name, and try again."
- On Windows, Claude starts when the Claude Code CLI comes from npm (`claude.cmd`). Before, every Claude session, model list and usage read failed with "spawn EINVAL", and sign-in and sign-out through such a CLI failed too. Stopping a session now also stops the Claude process that the `.cmd` file started.
- Keep the web client connected while a server sends many events. Before, it disconnected and connected again every few seconds during a turn.
- OpenBot no longer shows "OpenBot database is not initialized." when you quit it. The windows now
  hide when the quit starts, and the database waits a short time for a slow agent stop before it
  closes.
- A sleeping cloud server keeps its data when the hosting provider refuses its keep-alive start or
  its start for a routine run. Before, a refusal such as a billing error left the server in an error
  state, no automatic start tried again, and the provider deleted the server's disk 14 days after its
  last stop.
- Continue unfinished agent work after a provider reaches its usage limit and switches to a backup.
  Keep completed work, tool results and attachments with the request, including across backup models.
- Deleting an agent that runs on its own provider process, such as an agent with "Workspace only" access or a second provider account, now stops that process first. Before, on Windows the delete could fail and the agent came back until you restarted OpenBot.
- When a delete fails after the agent is already gone, the agent no longer comes back in the list until a restart.
- In a channel, an agent that posts its task result no longer shows a second short reply, such as "Yes.", under it. Before, the text that the agent wrote after the result showed as a separate message. Now it shows in the steps of the turn.
- The agent's browser `evaluate` tool no longer times out on pages with an ad frame that does not run its timers, such as Amazon product pages.
- On a server, agent builds no longer take all the CPU and memory and drop your connection. Before,
  a build such as `next build` started one worker for each CPU of the host, not of the server's
  limit, the server stopped answering, and the apps reconnected every few minutes. Agent processes
  now run at a lower CPU priority, and Node programs of agents see the server's CPU limit.
- When a server is almost out of memory, OpenBot now stops leftover agent processes first, such as
  preview servers and build workers that stayed after their job ended. Before, they kept their memory
  until the kernel stopped a process or the server restarted.
- Routine wake-up commands now run also when the long command fails, so an agent learns that its job
  stopped.
- OpenBot now starts the Codex app server again when it stops answering. Before, a hung Codex process stayed in use, and every agent turn and routine run failed until you stopped codex.exe yourself.
- When Codex does not answer, a message now fails with that reason. Before, it failed with "OpenBot could not register MCP servers in the Codex configuration", although `config.toml` was correct.
- Usage now shows the token cost of OpenCode turns, including OpenCode Go. Before, the OpenCode cost was always "Unavailable". The cost is the session cost that OpenCode reports, at API-equivalent rates, not the subscription charge. When earlier turns of a session have no cost, as in a session that started before this release, the first turn with a cost has no cost.
- Two reads of the history of one Claude session at the same time no longer fail with "database is locked". Before, this error could show when an agent continued on its backup model while OpenBot read the session history after a start.
- Connecting Firecrawl, or another plugin that starts with `npx`, no longer fails with "The server did
  not answer in 10 seconds" on its first start. A local server now has 60 seconds to download its
  package and answer. A server at a web address still has 10 seconds.
- When you drag a channel to a new place in a sidebar section, it now stays where the sidebar showed it would go. Before, the first drag after you moved a channel or an agent into the section with "Move to", or made a new one, could put the agents above the channels or put the channel in a different place. On a team server, the server must also have this version.
- The model picker for a new agent no longer starts on Claude when Claude is not installed or not
  signed in. It now starts on a provider that can run the agent, as the server already does.
- When an agent runs on a custom endpoint and the endpoint does not answer, the waiting notice and the error now name your endpoint. Before, they said "OpenCode has sent no update" and "OpenCode stopped responding", so it looked as if OpenCode's own models were in use.
- A message that you steer into a running DeepSeek or Pi agent now goes into the running turn also while Pi compacts its context. When Pi refuses a steer, only the steer fails: the agent keeps working, and the message waits in the queue. Before, the refusal stopped the turn in the chat while Pi kept working, and the next messages failed with "Agent is already processing".
- A "Could not steer the agent" error no longer stays below the last reply after the turn ends. Before, it stayed at the end of the chat until you sent the next message, so it looked like a new message.
- When you sign in a provider account of a joined server in this computer's browser, the dialog no
  longer says "This sign-in ended" while the server completes the sign-in. After the browser returns,
  the dialog shows the progress until the server gives the result.
- A channel whose agent waits for your answer, your approval, or you in the browser now moves to
  "Needs you" at the top of the sidebar, with the same badge and tooltip as an agent. Before, only
  the channel conversation showed it, so a request in a channel was easy to miss.
- Gemini (Antigravity) agents in a channel get only the messages they have not read. Before, each channel turn sent the complete channel history again into the same session, so usage grew with each message. Long channel sessions are now also compacted.
- A change to MCP servers or skills keeps the conversations of Claude agents. Before, each Claude agent started a new session on its next turn, with a summary of the history and no prompt cache.
- Agents in a channel report their result with fewer model requests. Before, an agent such as Grok searched for the channel tools first, and each search step sent the whole conversation again.
- An "always allow" approval for an MCP tool keeps the conversations of Codex agents. Before, each Codex agent that used that server started a new session on its next turn.

## [0.50.0] - 2026-10-25

### Added

- Show a storage card at the bottom of the sidebar when the disk of the selected server is almost full. A ring shows the used part of the disk. "Free up space" opens Server settings › Storage. You can close the card while the disk is almost full; it comes back, in red, when the disk is full. Only an owner or admin of the server sees it.
- "Open in new window" in the menu of an agent in the sidebar opens its chat in a window of its own, for example on a second display. Both windows show the same live chat, and a window mark beside the agent's name shows which chats have a window. Closing the window keeps the chat in the main window.
- A message that an agent sends to or gets from another agent now opens in the chat. Click the arrow on its line to read the text, and the message it answers.
- You can add more than one Google account to Gemini. Select Add account on the Gemini row, as for Codex, Claude and Grok, and choose the account for each agent. Each account keeps its own sign-in and usage. A saved Gemini API key applies only to the first account. This needs Gemini runtime 1.4.0 or later. On a joined server, the sign-in page opens in the server's browser, and you use it through the live view.
- Grok agents can now be steered. A message that you send in Steer mode while a Grok agent works
  goes into the running turn, and Grok reads it after its current step. Before, the message waited
  in the queue until the turn ended. A Grok CLI without this feature keeps the message in the queue.
- Settings › Agents sets the defaults of the agents on this computer: Local scripts, Agent starts new chats, Show the plan before long tasks, and Steer agents while they work. Each setting shows which agents have it on. Its page changes the default, the value of one agent, or the value of all agents with Set all.
- An agent that has no value of its own follows the default. The defaults start off, so no agent changes until you change a default.
- Give one server a custom member limit, such as for an enterprise customer. The limit replaces the
  limit of the server's plan.
- The Claude page in Server settings › Providers has a "Prompt cache" setting: 1 hour or 5 minutes.
  An owner or admin can set it for this computer and for a joined server.
- Korean interface. Choose 한국어 in Settings > General > Language, or keep System default on a
  computer that uses Korean. The web client uses it too.
- A custom ACP agent can have a usage command, such as `/usage`. OpenBot sends it at most every 5 minutes, and the agent's logo in the rail shows the last answer when you hover it. Use a command that the agent answers itself: other text starts a model turn each time.
- Server settings has a Vault page, after General. Save logins, payment cards and contact info on
  this computer, encrypted by the operating system. Agents sign in with the saved logins, fill a
  saved card on a checkout page, also in the card frames of payment providers, and type the saved
  contact info. An agent sees only the card name and its last four digits, never a password, a card
  number or a security code. Import logins from a password export in CSV format. The Vault is on the
  local server only.
- The first time an agent fills a saved card on a site, the server owner approves it. Later fills
  on that site need no approval. Remove a site from the card in the Vault.
- Agents can add and change contact info in the Vault, change the username of a login and the
  name and expiry of a card, and delete items. The chat shows each change, and the Vault shows
  which agent added an item. On the secure password card, Save to Vault keeps the password that you
  type.
- openbot.run has provider pages for Muse Code, Pi, Inception and ACP agents such as Goose, Qwen
  Code and GitHub Copilot CLI.
- The steps row above an agent's answer now opens a trace of the turn. Each thought, tool call and
  subagent is a bar on one timeline, with the duration, cost and tokens of the turn. You can search
  the steps with ⌘F (Ctrl+F), fold an agent's steps, replay the turn at up to 10× speed, and move
  between the rows with the arrow keys. A click on a step shows it in the chat.
- The steps row now looks like the subagents header above it. It shows the time of the turn and how
  many steps failed.
- Simplified Chinese for the desktop app and the web client. Select 简体中文 in Settings, or use a
  Chinese system language.
- The usage list shows each Gemini limit on its own line, such as Gemini Models, Gemini 4 Argon, and
  Claude and GPT models. The warning above the message box uses the limit of the agent's model.
- Claude can use an Anthropic API key. Open the Claude page in Server settings → Providers and select
  Add key. The key shows as an "API key" account. To bill an agent to the key, select the API key
  account in the agent's model menu. Other agents keep the Claude plan. When Claude has no sign-in,
  all agents use the key. A joined server shows the key when the server also has this version.
- Add Cloudflare to the Apps catalog. After you sign in to your Cloudflare account and choose Read only
  (or more) on its consent page, agents can work with Workers, DNS, R2, D1 and KV, query Workers logs and search
  the docs.
- A Workflows page in the page rail. Draw a workflow on a canvas with agent, model, condition, approval and output steps, and connect them. The workflow saves while you edit it.
- Run a workflow, or one step of it. You see each step's status and answer on the canvas, and you can stop, retry or approve a step.
- A condition step asks a model a yes or no question. Only the steps on that branch run.
- A workflow can loop: connect a step back to an earlier step, and the steps between them run again with the new answer. The canvas marks each loop, and warns when no condition can end it.
- An output step shows a notification or posts the result to a connected messaging place. Only an owner or admin can choose the place.
- A workflow can start on a schedule or from a signed webhook request.
- Version history: preview an earlier version of a workflow and restore it. Undo gets back the canvas from before.
- Members of a joined server can open and run the workflows whose agents they can use. To change, delete or restore a workflow, a member needs “Can manage” on each of its agents; otherwise the canvas is read-only.
- Usage shows the tokens of workflow model and condition steps in one Workflows row. Steps that use an agent count under that agent.
- Consecutive model and condition steps reuse one started provider for 5 minutes, so they start faster. Each step still starts with no earlier text.
- When analytics is on, OpenBot counts workflow actions and runs: the kind of action, the outcome, the duration and the step counts. It never sends a workflow name, step text or graph.

### Changed

- The Linux docs and the Linux download page on openbot.run now name Ubuntu 26.04 LTS. OpenBot
  0.48.1 runs on Ubuntu 26.04 with the Electron sandbox on.
- When nothing comes from the provider for a minute during a turn, the activity line says "Waiting for {provider}…" and stops its shine. A notice above the message box says how long the provider has sent no update. Before, the line looked busy the whole time, also with no internet.
- When the computer has no network during a turn and nothing comes from the provider for 5 seconds, a "No internet connection" notice shows above the message box, and the activity line says that it waits.
- On a joined server, Add account for Codex and Claude opens the sign-in page in the browser of your computer, as the first account does. Before, the page opened in the server's browser, and you used it through the live view. That was slow, and a magic link or a CAPTCHA could stop the sign-in. A server on an older version still uses the live view.
- On a very wide window, such as an ultrawide monitor, the chat now stops at a 1440 px column in the
  center of the pane. Before, the user's messages were at the right edge of the pane and the agent's
  replies at the left edge. A laptop window shows the chat at full width, as before.
- When you try to turn off a provider that an agent uses, a toast now tells you why the switch stays on. Before, the row showed red text with the names of all the agents. When more than one agent uses the provider, the toast gives their number.
- "Steer agents while they work" moved from Settings › General to Settings › Agents.
- The sidebar no longer shows a presence dot on a person's avatar. The dot sat outside the shape of avatars with no photo. The conversation header still shows whether the person is online.
- The app demo on the home page now shows a team of four agents, each on a different provider: Claude, Gemini, ChatGPT and Grok. The lead agent plans a launch, sends work to its teammates, asks you a question and answers with a table and a diagram. Each teammate plays its own short scene when you open it, and a message that you type gets a reply. The sidebar groups the chats in sections and shows a launch channel with a chat history.
- Claude agents now keep the prompt cache for 1 hour by default, also with an Anthropic API key,
  for subagents, and on a subscription that uses extra usage. Before, these used 5 minutes, so a
  turn that started later sent the full context again at the full price. A 1-hour cache write costs
  more than a 5-minute write; choose "5 minutes" to go back to Claude Code's own choice. A `promptCacheTtl` in the Claude settings, or
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, still sets the time.
- In a channel, the activity row now shows the name of each agent that works, before the activity
  text and in the colour of the agent's messages. Before, it showed only their faces.
- Agents now follow your user-level `CLAUDE.md` or `AGENTS.md`, and the one at the root of the agent
  workspace, when these files set the persona, reply length and format, delegation, or group-chat
  behavior. Before, OpenBot's built-in style guidance and your files gave the agent two rule sets for
  the same decision. Files in cloned repositories do not get this priority. The rules for tools,
  memory, approvals, secrets, private details, safety checks and the browser do not change.
- A focused field shows a grey border, and a focused button shows a thin grey ring. They no longer
  show a blue glow.
- The comparison pages on openbot.run now list all the providers that OpenBot runs, including Muse
  Code, Pi, Inception and ACP agents, and 11 app languages. New rows compare backup models and
  logins and payments, and most pages also compare voice and Slack, Discord and Telegram.
- The home page and `llms.txt` on openbot.run now name the new providers and backup models.

### Fixed

- An agent set to switch to a backup model without asking now switches when its provider is overloaded or down. Before, it showed the error and stayed on the failing model for Claude's "529 Overloaded" errors, Codex's server, overload and retry-limit errors, Gemini's UNAVAILABLE status, and dropped connections.
- A channel message that stopped because the channel had no lead now continues when you choose a lead. The new lead routes it. Before, it stayed stopped until you clicked Continue.
- Channel members now know which member is the lead.
- The x64 remote desktop runtime now starts on Ubuntu 26.04 LTS. Before, it needed
  `libminiupnpc.so.17` and `libicuuc.so.74`, which Ubuntu 26.04 does not have, and the Docker image
  with `BASE=ubuntu:26.04` did not build.
- Remote desktop now starts in the Docker image on Ubuntu 24.04. Before, Sunshine stopped because
  `libnuma1` was not installed. The server install now also installs it.
- When a Grok turn fails after it used tokens, the error now shows the reason that Grok gives, such as `empty response from model (reasoning_only)`, and not only `Internal error`. The routine run history keeps the same reason (#2980).
- When you stop a sign-in that a joined server relays to your computer, the provider list now shows the change at once. Before, a new account that you stopped stayed in the list for some seconds.
- An app that an agent suggests in a chat, such as Linear, now shows a green Connected button with a check after you connect it. Before, the card kept its Connect button.
- When an agent asks another agent for help, the "Waiting for replies" list now shows when that agent waits for your approval, your answer, the browser, or a usage limit. A button opens its chat, where you can answer. Before, the list showed "Working" until the wait ended.
- The agent usage page now counts all Gemini tokens. Antigravity 1.4.3 sends the tokens of each
  turn, but OpenBot added them as a session total, so a turn smaller than an earlier turn in the
  same session counted as 0. Gemini thinking tokens now also count as output. Usage that was
  recorded before this fix does not change.
- The app demo on the home page no longer shows a time zone prompt, an update card or a helper agent from another server. Its dates now show today.
- On a phone, the app demo on the home page now shows all four agents in one row and the chat under them. Before, only one agent showed and the chat area was empty.
- Support service usernames with uppercase characters in server setup and update scripts.
- Gemini now shows the Claude and GPT models that your Google plan includes, such as Claude Sonnet
  and Claude Opus. Before, the model menu showed only Gemini models.
- Claude agents use less of the Claude plan. A sidebar move or a teammate rename no longer starts
  the Claude conversation again with a new system prompt: the list of section teammates now goes
  with the next message, as the saved memories do. Before, the full conversation was sent to the
  model again and written to the prompt cache.
- A Claude conversation no longer restarts when it is opened again with the same settings after a
  model or effort change.
- Claude, ChatGPT and Muse channel members use less of their plan. A member's next assignment in
  the same conversation gives only the channel messages that it has not read. Before, each
  assignment sent the recent channel history again, up to 60,000 characters. The first assignment
  after a start of OpenBot, a new conversation, a provider change, or a compaction still sends the
  complete history.
- A provider account that you add now shows its usage rings in the page rail when its sign-in ends. Before, the rings showed only after a reload or the next usage refresh, up to 5 minutes later.
- On a joined server, the usage rings no longer go away when the host resets the usage of a provider account.
- When two or more notifications were open, you could not reach a notification under the first one.
  The stack closed when the pointer moved onto it, because the notifications were over the part of
  the window that moves the window. Only the buttons of the first notification responded.
- The waiting block, the queue, a reply and the notices above the message box are now one card,
  with a line between each part. Before, each part was a separate card, with gaps and cut edges
  between them.
- An agent can click a choice, such as a payment method, when a decorative layer of its label covers
  the radio button.
- The first Claude turn after OpenBot starts again now has a cost in Analytics and in the turn trace.
  OpenBot estimates it from Anthropic's list prices, because Claude does not report the cost of that
  turn.
- The Live Activity updates that OpenBot sends to your iPhone cut a long code span with emoji at the
  correct length. Before, the cut could split an emoji into half a character, and an emoji counted
  as two characters, so the text stopped too early.
- The Live Activity updates that OpenBot sends to your iPhone show a reply that starts with inline
  code in three backticks, such as ```` ```npm install``` first ````. Before, the update read that
  line as the start of a code block: the line disappeared and the next lines showed as code.
- Gemini usage now follows the limit of the model that an agent uses. Google can give a model, such
  as Gemini 4 Argon, a weekly limit of its own. Before, OpenBot put all Gemini limits together, so a
  spent Argon limit could show for Gemini 3.8 Flash, or Argon could show room that it did not have.
- Stop showing a "Provider error" when Codex completes a credential storage fallback. Keep the redacted diagnostic in the provider log. Authentication and storage failures still report errors.
- A sign-in to a Google MCP server, such as Gmail, Calendar or Drive, now keeps working after the
  first hour. OpenBot asks Google for a refresh token. **Sign in to these servers again after you
  upgrade.**
- A custom provider with a base URL on `api.anthropic.com` now uses Anthropic's Messages API, so
  OpenCode adds prompt cache breakpoints. Before, it used Anthropic's OpenAI-compatible endpoint, which
  does not cache, so each turn paid the full input price.
- Usage and cost for OpenCode turns now count the uncached input, the cache reads and writes, and the
  thinking tokens of each turn. Before, a turn could show no uncached input.
- Analytics now records why a provider download failed, for example no disk space or a failed
  checksum. Before, each failure was recorded as `unknown`.
- When you save or remove a provider API key, agents that a usage limit held now continue at once.
  Before, they waited for the old plan's limit to reset, which could take days.
- Sign in to an MCP server again when OpenBot cannot read the saved sign-in file. Before, Connect
  stopped with "The MCP sign-in file is unreadable" until the file was deleted, which dropped every
  saved MCP session.
- Restart now closes turn rows that stayed `running` although no thread names them as its active turn. Before, such rows stayed `running` for good, as the follow-up data on #2214 showed.
- An OpenCode agent with more than one chat keeps its OpenBot tools. Before, about 10 minutes after
  its other chat went idle, every OpenBot tool call failed with `{"error":"unauthorized"}`, including
  routines, teammates and the browser, until OpenCode restarted. Each tool call also runs in the chat
  that made it, when two chats of the agent work at the same time.
- A long channel keeps working when its history summary comes back too long. OpenBot now asks the lead for a
  shorter summary, and asks once more when the result is still too long. Before, every new assignment in that
  channel failed with "The history summary is invalid" and "The provider could not start this assignment".

## [0.49.0] - 2026-10-24

### Added

- You can change the key of the server on this computer in Server settings › General › Server key. Computers with this version or later, the web client and webhook routes stay connected. Before, a new key showed "Server identity changed" on each device, and each phone had to scan a new code. Older versions of OpenBot and the current phone app still show "Server identity changed". Do this if the key file was copied or exposed.
- The website compares OpenBot with Viktor at /compare/viktor: models and price, where agents work, what each one reads, who holds your data, teams, approvals and integrations.
- Connect Bitwarden or a self-hosted Vaultwarden on a joined server. In Server settings › Connectors, an owner or admin enters the server address, the personal API key and the master password. The server signs in with its own Bitwarden CLI, downloads it when it has none, and unlocks again by itself after a restart. Agents on that server can then sign in to sites with the logins in the folder Shared with OpenBot. This works from the desktop app and the browser client.
- The website compares OpenBot with Paperclip at /compare/paperclip: setup, phones and remote access, how you work with agents, price, and license.
- When a task needs an API key or a token, the agent now shows a secure form in the chat, as it does for passwords. The key is saved for that agent on the computer or server that runs OpenBot, outside its workspace, and the agent reads it from a file. It does not go into the chat, the logs or a tool argument, and you do not need to connect to the server to give it. Only the server owner or an admin can enter a key. To remove a key, ask the agent to remove it. Deleting the agent deletes its keys.
- Mobile Connect settings can keep chats and files on a private network. Choose "Private network", and phones, other computers and team members connect to this computer only over Tailscale or the same Wi-Fi. They still sign in with OpenBot, but chats and files never go through OpenBot servers. Settings shows when Tailscale is connected.
- Let an owner or admin of a connected server, self-hosted servers included, change "Tasks at once"
  for each agent of that server in the agent's Advanced settings. The server saves and applies the
  limit. Before, only agents on this computer had the setting.
- While an agent works, a chevron on its activity line opens the steps of the turn: its thinking, its tool steps, its memory searches and the skills it uses.
- A finished answer has a closed "N steps" row above it with the same steps, and the memories that the turn saved, updated or forgot. Tool steps stay until the app closes; thinking and memory changes stay after a restart.
- The "Show agent steps" setting (Settings > General, and Preferences in the web client) opens the steps by default on that device.
- A light theme on the desktop and in the web client. Settings > General > Theme has System, Light and Dark. Dark stays the default, so the app does not change after the update. In the web client, the choice is in Preferences and this browser keeps it.
- On macOS, Settings > General has a Transparent window switch under Theme. When it is on, the main window shows the blurred desktop behind its frame and pages. Dialogs, menus and cards stay solid. While it is on, visited websites and the native menus use the app theme, not the computer's setting.
- A visual reply has a full-screen button. The page keeps its state when it goes full screen and back. Esc or a click outside the page closes the full-screen view.
- A click on an image in a visual reply opens the image in the image viewer.
- Search, Settings and the server number shortcuts work while a visual reply has the focus.
- A visual reply can answer the agent. A button in the page puts text in the message box, and you send it. The page cannot send a message itself.
- A visual reply can give the agent its current state. A button in the page puts the state in the message box as a quote of the page, and your next message sends it.
- A new chat with an agent is no longer blank. It shows the agent, its description, and a faint sample turn: the agent's own routine is asked, and the steps of the turn fill in one at a time. With reduced motion, the sample turn stands still.
- Named browser profiles. In agent settings > Advanced, an agent can use the shared profile or a named profile. Agents in one named profile share its sign-ins, so two agents can work in one account while other agents use other accounts on the same site.
- "New profile" at the end of the browser profile list makes a named profile and gives it to the agent in one step. Server settings > Browser profiles shows the shared profile and adds, renames, clears and deletes the named profiles. "Manage" in agent settings opens it. A deleted profile's agents change to the shared profile.
- The browser toolbar shows the profile of a tab that is not in the shared profile.
- On a joined server, an owner or admin manages the server's browser profiles and chooses each agent's profile, on desktop and on the web. Each member sees the profile of the server's tabs. This needs no setup: the controls show when the server runs this version or later.
- Each named profile has a color, and the shared profile is gray. The browser profile list, the browser toolbar and a line under each tab show it, so the tabs of different accounts look different. A new profile gets a color that no other profile uses, if one is free. Server settings > Browser profiles changes it.
- The Tasks page before the first task is no longer blank. It shows a short pitch, the composer under it, and a faint sample list: a task arrives in Waiting, moves to Working, then to Needs you as Answered, and fades. With reduced motion, the list stands still.
- Back and Forward arrows in the sidebar top bar open the chats that you opened before, as in a browser. The keys are ⌘[ and ⌘] on macOS and Alt+← and Alt+→ on Windows and Linux. The side buttons of a mouse also work. The history stays in memory for the open server.
- On macOS and Windows, the "Keep this computer awake" setting (Settings > General) stops the idle sleep of the computer while it is connected to power, so routines run on time. It is off by default. On battery, the computer sleeps as usual, unless you also turn on "Also on battery". The display can still turn off, and a closed laptop lid or a sleep that you select still sleeps the computer.

### Changed

- Each plugin page on openbot.run now shows what an agent can do with the plugin, how to connect it to OpenBot, common questions, and the sources for each statement.
- The guides "OpenBot 101" and "WTF Is OpenBot?" now have the titles "How to Use OpenBot: Set Up Your First AI Agent" and "What Is OpenBot? Models, Providers and Agents Explained". Their addresses did not change.
- A message that you send no longer shows "Sending…" or turns grey. Only a failed send shows: "Not sent" and its reason beside the time, with Retry, Edit and Dismiss buttons.
- Product analytics on turns sends how the turn is paid for: a plan, an API key, a free model, or your own endpoint. It does not send keys or accounts. The privacy policy lists the new data.
- The web client and the desktop app on Windows and Linux show the OpenBot logo in the top-left corner of the window. Before, this corner was empty, because only macOS shows window buttons there. In the web client, the logo opens the OpenBot site.
- On these windows, the server menu starts at the same left edge as the search field and the sidebar rows.
- A schedule with no routines now shows a faint month where sample runs land and write a short note of what they did, with "Set it once. Wake up to it done." The "Create Routine" button asks which agent to use when the server has more than one, and opens that agent's routine settings on a new routine.
- An agent or a channel with no memories now shows a faint memory list that fills in by itself: each sample memory writes itself in handwriting, then becomes a normal row. The title says "Tell it once. It will remember.", and an "Add memory" button opens the editor.
- An empty "Pending invitations" list in server settings now shows faint sample invitations that appear one at a time, and an "Invite people" button that opens the email invite field. Before, it showed only "No pending invitations."
- An agent's routine canvas with no routine shows how a routine works. A faint sample diagram builds itself, and one run goes through it. "Create Routine" opens the agent's settings on a new routine. With reduced motion, the canvas shows the finished run and does not move.
- The "Own browser session" switch in agent settings is removed. An agent that uses its own session keeps it, and the browser profile list shows it as "Only this agent" until you choose another profile. Use a named profile for a new agent.

### Fixed

- An hourly routine can now run between two times that cross midnight, for example from 8:00 PM to 10:00 AM. Before, the routine form showed "End time must be after start time" and did not save the routine. A run after midnight uses the days of its own date: with Monday to Friday, a run at 2:00 AM on Saturday does not occur.
- A long chat keeps the older messages that you scrolled back to when a new message, a routine
  update or a reaction arrives. Before, the chat showed only its latest 100 messages again, and a
  message that you opened from search jumped to the end of the chat.
- Fold the thinking of a channel member into steps, as in an agent chat: under the activity line
  while the member works, and above the member's answer after. The unread count of a channel no
  longer counts this thinking. Before, each part of the thinking showed as a message, and a model
  that sends all its reasoning, such as DeepSeek, showed a very long message.
- Keep a failed Codex tool call, such as an image generation that fails, out of the ChatGPT
  provider error notice. Before, the notice stayed on screen in each chat that you opened, also in
  chats of other providers. The agent still gets the error as the tool's result.
- After an in-app update installs, OpenBot deletes the downloaded update file when the new version starts. Before, a copy of the full update stayed in the updater cache on macOS and Windows. A downloaded update that is newer than the running version stays until you restart.
- A long preview in an agent's confirm card now has a "Show all" button that opens the full text, and "Show less" closes it again. Before, the preview stopped at a fixed height with no visible sign that more text was there.
- **On macOS, sign in to Gemini again after you upgrade.**
- On macOS, a Gemini agent with Workspace only access now uses the Google sign-in. Before, it stopped with "Gemini did not return an authenticated account" while Settings showed Gemini as connected.
- The web client connects to a server again in seconds after a connection stops working. Before, on a server that uses a relay, it could wait up to a minute when it still received data from the server.
- In a channel, Open on a "Complete the step" browser card now opens the page in the chat of the agent that asked. Before, Open did nothing, and the card showed "Browser page" with no preview.

## [0.48.2] - 2026-10-23

### Added

- In Server settings > Roles, a role and Everyone have a **Set all** menu. It gives one access level
  to all agents at once, so you do not set each agent one by one.
- Voice prompts and read-aloud replies work on Linux (x64 and arm64), as on macOS and Windows.
  Before, the Linux app showed no microphone and no Voice settings.
- You can now duplicate a whole sidebar section from its menu, in the desktop app and the web
  client. OpenBot makes a "copy" section right after the first one and copies every agent in it.
  Each copy keeps its settings and files, and starts with no messages. If one agent cannot be
  copied, for example because it is busy, the copy stops and keeps the agents it already made.
- "Send test event" signs an event that matches the routine and receives it as a real request. The
  routine runs once, and the editor says whether the run started or why it did not. A joined server
  must also run this version.
- The Marketplace has the Dr. Eggbot agent. It designs focused agents, then creates them and checks
  the result. It installs with pstack, five skills of its own, and two paused healthcheck routines:
  a weekday scan of agent chats for friction and a Monday audit of routines for token waste.
- An agent can now give several agents the same provider, model, reasoning effort, access,
  Computer Use, or notifications setting in one step, for example when you ask it to move your
  team to a new model. It tells you the result for each agent, and a failure for one agent does
  not stop the others. As before, an agent can only restrict access and Computer Use.
- Agents can see the accounts of each provider, and read and set which account an agent uses and
  its backup models, with their accounts, when you ask them. Agents see the account names, never the
  credentials.
- When an agent's backup models are set to Automatic, a provider error now moves the agent to the next backup model too. This covers a spent balance, an unavailable provider, a rate limit, a sign-in error and a network error. The message runs again on the backup when the agent had not started to write, and the agent goes back to its own model after 10 minutes. Before, only a usage limit moved the agent.
- `read_agent` now says when a provider error, not a usage limit, keeps an agent on a backup model.
- Show the Cursor plan usage next to the other providers' usage. The Cursor ring shows the usage of Cursor's own models and of all other models for the billing cycle. OpenBot reads the Cursor CLI's sign-in to ask Cursor for this usage.
- Right-click a message to reply to it, copy it, react to it or read it aloud. React opens all
  reactions in a submenu. Shift+F10 opens the menu from the keyboard. Over selected text or a link,
  right-click still opens the menu that copies them.
- An agent can now mark its routine run as failed when the task could not be done, for example when
  a server it checks is down. The run history shows the run as failed, with the reason. The answer
  still shows in the chat and still goes to the routine's result destination. In a routine flow, the
  agents after a failed step are skipped.
- On Windows, the installer lets you choose the disk and folder for OpenBot. Before, it always
  installed to `%LOCALAPPDATA%\Programs\OpenBot`. Updates keep the folder that you chose.
- A channel member can now change its channel when a person asks for it in the channel: add or
  remove a member, change the channel instructions, and make, change or delete the channel's
  routines. Each change shows in the channel with the agent and the person who asked. A routine run
  or an agent's own request cannot make these changes.
- Agent settings have a new switch, "Own browser session". When it is on, the agent's browser tabs keep their own cookies, sign-ins and site data, apart from other agents. Two agents can then use different accounts on the same site, such as WhatsApp Web or Gmail. The switch is off by default, so agents keep the shared session and its sign-ins. A change closes the agent's open tabs. Deleting an agent deletes its own browser session.
- Reset the usage limits of a Codex account from Settings > Providers. When Codex gave the account a usage reset credit, the account's ⋯ menu shows **Reset usage**. OpenBot asks for confirmation, spends one credit, shows the result, and starts the agents that the limit held. This works for each Codex account, also on a joined server where you are an owner or admin.
- Sign in to a site for a server's browser on this computer. In the browser's page menu, select
  "Sign in on this computer" and sign in in the window that opens. When the sign-in is complete,
  OpenBot sends only that site's sign-in to the server, the tab loads again signed in, and the window
  closes. If the window stays open, select Done. This helps with sites such as X
  that refuse a sign-in from a server address. The server must run this version.
- When a site refuses a sign-in from the server, the agent shows a card that says so. In the desktop
  app, the card has one main button, "Sign in on this computer". After the sign-in, the card shows
  that you are signed in, and the agent continues.
- The website has a privacy policy at openbot.run/privacy-policy. The "Privacy policy" link in the
  site footer opens it. Before, the footer linked to the privacy notes on GitHub.

### Changed

- When you open an agent, the cursor goes into its message box, so you can type immediately.
  Before, the focus stayed on the item that you clicked.
- An agent needs fewer steps before it uses a tool, so a run, such as a routine, sends fewer input
  tokens. A tool search now also gives the schema and guidance of its best matches.
- When you type `@` and part of a name, the agents whose name matches show first, then the agents
  whose title matches, then the agents whose description matches. The match ignores accents, so
  `e` finds `é`. Before, the list kept its order for all matches.
- OpenCode answers now appear while the model writes them, not only when the answer is complete.
- In the desktop app, the error above the message box now names the provider and model of the run that failed, so you can report it.
- A webhook routine now shows its setup as three steps: copy the endpoint, add the signing secret to
  the sender, and send a test event. A new routine has a "Save and get the endpoint" button, and
  "How to sign a request" shows a curl example. Schedule and Webhook are now two buttons above the
  trigger, not an item in a menu.
- The agent and channel settings panel opens wider, so routine settings have more room.
- Save now tells you what is missing, under the name, the instruction or the filter, instead of
  staying unavailable.
- On Windows, Restart and install updates OpenBot with no installer window, then opens it again.
  **The update from 0.48.1 or older still shows the installer window once. Select Finish to open
  OpenBot again.** Your settings, agents and chats stay.
- The Starter plan of hosted servers is sold out. The add-server dialog shows it as sold out, and a new server must use the Standard or Pro plan. Servers that have the Starter plan keep it.
- A server with 5 GiB of memory or less, such as the Starter plan, now runs at most 2 turns at the same time. Other messages wait in the queue for a free slot. Before, 4 turns could start together and show a low-memory notice on a server that still had memory.
- Voice recording warns you before its 2-minute limit. The last 15 seconds count down in the recording bar, two short pips play at 10 seconds left, and a chime plays when it stops. Before, the recording stopped without a sound and you could keep speaking without knowing. A notice above the message box now says why the recording stopped.
- The model picker now shows only the providers that can run: in a conversation, when you create an agent, on the routine canvas, and in the Slack and Telegram settings. If you can manage providers, a plus button in the picker opens the provider settings so you can add one.
- In the full browser view, you now answer an agent's questions and approvals in the dock over the
  page. Before, the dock only told you to go back to the chat.
- On the browser takeover card, Cancel is now on the left, and "I'm done" is the main button on the
  right. On a server, "Sign in on this computer" is next to "I'm done".

### Fixed

- An agent now uses its browser tabs for a web service that has no tool of its own, such as mail.
  Before, a routine run in its own session could not find a tool for the service and reported that
  it had no access, although a signed-in tab was open.
- When an agent makes or changes a routine, it now writes an instruction that a run can follow
  without the chat: the service, the tool or browser tab, the account, the steps, and when to
  report. A run starts with only the newest chat messages, so an instruction such as "check the
  mail as before" did not tell it how.
- Gemini Reconnect now opens the Google sign-in page, so you can sign in again or use a different
  Google account. Before, it checked the saved sign-in and nothing seemed to happen.
- A long message in a card that asks if the agent can send it now scrolls, so you can read all of
  the message before you answer. Before, the card showed only the first lines.
- A Codex chat now starts when `~/.codex/config.toml` has an MCP server with the same name as an
  OpenBot MCP server of the other type, such as a local `github` server and the GitHub connection.
  Before, Codex showed "url is not supported for stdio" and did not load its configuration. The
  OpenBot server now goes to Codex as `openbot_<name>`, and your own server stays as you wrote it.
- An OpenCode 2.1 turn that failed in OpenCode's local service now says so and tells you to try again or reconnect OpenCode. Before, the chat showed only "Internal error: Internal service failure".
- A provider error that is not tied to a chat, such as a provider that did not start, now names the provider in its title, for example "OpenCode error". Before, the title was "Provider error", so you could not tell which provider failed.
- An OpenCode turn that stops sending anything now ends after 5 minutes with an error that says so. Before, the chat could show "Working on it…" for an hour, and each message you sent again waited behind it. This also applies to Cursor, Cline, Grok and custom ACP agents. A running tool call or a question that waits for you does not count.
- Stop now ends an OpenCode turn also when OpenCode does not stop it. Before, the turn could stay active after you pressed Stop.
- An MCP server with a space or another special character in its name no longer stops Gemini and other ACP agents. Before, each task failed with `invalid params`. OpenBot now changes these characters to `_` when it gives the server to the agent.
- A reminder routine now sends its message in the chat when it runs. Before, the agent could decide
  that the reminder had nothing new to report, and the run completed with no message.
- Show why channel routing failed, for example when the lead's model is unavailable, the lead did not
  answer in time, or the lead could not route the message. Before, the channel showed only "Routing
  failed. Choose a member or try again.", and no log recorded the cause.
- A file link in a channel now opens the file in the preview panel, in the desktop app and the web
  client. Before, a click on a link to a shared file or to a file of an agent's workspace did
  nothing. A workspace link opens the file from the workspace of the agent that wrote the message.
  A quote of that file in a channel opens the same file again.
- GPT-6 models in ChatGPT (Codex CLI) now call the tools of your MCP servers, such as Composio.
  Before, the server test found the tools, but the model did not see them and asked for another
  message. Existing conversations get the fix on their next message and keep their history.
- Pi now shows as connected soon after you sign in with `/login` in Pi on the host computer, also
  over SSH on a server. Before, it stayed signed out until OpenBot restarted.
- A hosted server that nobody uses for 10 days now starts for a short time and then goes back to sleep. This keeps its data: the hosting provider deletes the disk of a server that stays stopped for 14 days.
- OpenBot no longer quits on macOS when an agent opens a page that redirects to another page while it loads, such as a sign-in or consent page.

### Security

- MCP servers that OpenBot starts with its own Bun now use Bun 1.4.4. It has security fixes for
  TLS, HTTP, WebSocket and `fetch`. OpenBot downloads it when an MCP server needs it.

## [0.48.1] - 2026-10-22

### Fixed

- Route channel messages again when the lead agent uses a free OpenCode model. Before, every
  message stopped with "Routing failed. Choose a member or try again.", because OpenCode refused the
  routing request. Agent profiles that a free OpenCode model writes work again too.

## [0.48.0] - 2026-10-22

### Added

- In Server settings → Providers → Custom, each saved endpoint on this computer has an Edit button.
  You can change its name, base URL, API key, models and headers. Leave the API key and the header
  rows empty to keep the saved key and headers. Headers that you type replace all the saved headers.
  To use a different server address, type the saved key and headers again. The provider ID does not
  change. A joined server's endpoints do not have Edit yet.
- Settings → Voice has a Remove button for each downloaded dictation model and for the speech model
  that reads replies aloud. Remove deletes the model files from this computer. A dictation model
  that you use downloads again at the next dictation. Replies are not read aloud until you download
  the speech model again.
- Settings → General → Appearance has an Interface size control, from 67% to 200%. It changes the
  size of text and controls in OpenBot, and OpenBot keeps it after a restart. ⌘ + and ⌘ − (Ctrl on
  Windows and Linux) also change it, and ⌘ 0 sets it back to 100%. The View menu has Actual Size,
  Zoom In and Zoom Out.
- You can choose a GIF as an agent picture, a profile picture or a server logo. An animated GIF
  stays animated. OpenBot stores it as an animated WebP.
- The home page of openbot.run has the LaserFlow light beam from React Bits again. It falls onto the
  app preview and spreads along the top of the preview, in a soft violet haze. The light moves toward
  the pointer. The app preview has no shadow or glow around it.
- The beam has a different colour, width, spread, haze and smoke on each visit. The smoke can be
  soft, or sharp with fine wisps. The colour is a blue, violet, pink or red, such as #3847ff, and
  is never yellow or green. With the reduced motion setting, the beam does not move.
- The beam waits until the app preview has loaded, then falls in. The preview appears as the beam
  hits it. On a slow GPU, the beam uses a smaller canvas.
- On a wide window, the beam falls through the Download button in the site header, and the button
  rim has the colour of the beam. The Community and App buttons in the site header and the
  "Available on" label in the hero are frosted glass. The App button is after the Download button.
- The React Bits license does not let a public repository contain the beam, so it is in a private
  repository. A build from the public source code has no beam.
- In a voice conversation, speak while the agent thinks or reads its reply to interrupt it. The
  reply stops, and what you say becomes your next message. The Stop button still works too.
- Channels are back. The host offers channels to the web client again, and agents in a channel can
  assign work, transfer a task, post a result and read the channel history. Channels that the
  earlier release archived stay archived.
- Agent import offers group chats as channels again.
- In a channel, agents can show a plan card, an `ask_ui` block and an HTML page, and can capture the
  screen. Each screen capture in a channel asks first, also with Full access, and the request names
  the channel.
- The desktop app and the web client notify you when an agent replies in a channel that you do not
  have in front of you. A click opens the channel.
- A question, an approval or a browser step in a channel names the channel in its notification, and
  a click opens the channel.
- The desktop app shows channels again on a server that offers them. Create one from the "+" menu
  in the sidebar.
- Restore a deleted channel from its row menu in Deleted channels, on desktop and web. This also
  brings back the channels that the earlier release archived.
- When OpenBot closes by itself, it now leaves a local record of the reason: a `Quitting` line in
  `logs/main/main.log`, an `exit` line and immediate process exit lines in `logs/trace.ndjson`, and
  a crash dump in the `Crashpad` folder when a process crashes. Nothing is uploaded. Do not attach a
  crash dump publicly: it can hold secrets.
- Agents can list their open waits with `openbot.list_waits`, with each wait ID, note, open time and
  the routine that wakes it, and close a finished wait by ID. Before, an agent at the limit of 20
  open waits could not find the IDs, so it could not open new waits.
- `openbot.list_agents` shows the number of open waits of each agent. An agent can list and close
  the waits of another local agent with `agentId`.
- When an agent is close to the wait limit, a new wait tells it to close finished waits. At the
  limit, the refusal lists the open waits.
- Owners and admins of a joined server can now set an agent's backup models from the desktop app
  and the web client. Before, only the computer that runs the agent showed the setting, so a hosted
  server had no way to set it. Members do not see it. The server must also run this version.
- You can install OpenBot with Nix on x64 or arm64 Linux and on Apple silicon:
  `nix run github:nightly-labs/openbot`. Nix installs OpenBot updates. A copy that Nix installed does
  not update itself; Settings shows that Nix installs its updates.
- Gemini agents now show how full their context is, next to the send button. When the context is
  80% full, OpenBot compacts it: the agent continues in a new session that starts from the recent
  conversation. The agent, its chat and its files stay.
- The context popover has a "Compact now" action for Gemini and Codex agents. It compacts the
  context at once, below 80% too.
- The Usage panel shows how much of your Gemini weekly limit is left, and when it resets. This
  needs a Google sign-in and Antigravity 1.4.1 or later: install the update that the Gemini provider
  page offers. Before, Gemini always showed "Not reported".
- When a saved Gemini API key runs your Gemini agents, the Gemini provider page says so. A saved key
  always comes before your Google sign-in, so the work uses the key's project and not your Google AI
  plan, and the Usage panel shows no Gemini limit.
- When your device's time zone changes, OpenBot asks if you want to move your routines to the new zone. It asks for this computer and for each joined server where you are an owner or admin, in the desktop app and the browser client. The routines keep their clock times, IDs and run history. Before, a routine always kept the zone it was made in, so after a trip it ran at the wrong local time.
- A joined server now lets its owners and admins choose, from the mobile app, where an agent
  routine sends its answers: Slack, Discord or Telegram. The server must run this version.
- You can ask an agent in chat to make a webhook routine, for example "start when my CI sends a
  failed build". The agent makes the routine and gives you its URL and the request format. A card
  in the chat shows the URL, and you make the signing secret there. The agent never gets the
  secret. The routine shows in the Routines settings with the other routines.
- You can change which events start a webhook routine from the chat. Ask the agent, for example
  "only for the main branch", or change the event type and the filters on the card and press Save.
  The URL and the secret stay the same.

### Changed

- **Check agent** for a custom ACP agent now also shows the agent's models, so you can see what the
  agent offers before you save it. An agent that lists its models only after sign-in still passes
  the check.
- A joined server can now show you agents on providers that your OpenBot does not know yet. The
  agent stays in your list and you can chat with it. Its provider and model choices are disabled
  and show "Update OpenBot to use" and the provider name.
- New providers no longer need a new Team API version. Older OpenBot versions do not see agents
  on providers that they do not know.
- Tasks opens in the main pane, as Routines does, and the server menu stays at the top. The agent list is hidden until you click the panel button in the Tasks header. A click on an agent opens it, and a click on Tasks goes back to the tasks.
- Channel work holds only the agent that does it. Other agents and their tasks keep working, and an
  agent's own tasks run beside its channel turn. Only tasks that declare the same browser or folder
  run one after the other.
- A channel in the desktop app now opens in the same chat view as an agent. Plan cards, visual
  replies, questions with choices and approvals show in the channel, and each message names its
  agent once for each run of messages.
- A channel in the web client now opens in the same chat view as an agent, with plan cards, visual
  replies, questions with choices and approvals.
- The Usage tab now shows tokens without cache reads in its total, chart, shares and daily data.
  Before, the total also counted cache reads. Each model request in a turn reads the whole cached
  conversation again, so cache reads made the total about ten times larger than the new tokens.
  Totals still show cache reads as Cached input, and the estimated cost does not change. For a
  remote server, the token chart shows one total line instead of one line for each provider.
- Agents on ACP providers (such as OpenCode, Grok and custom agents) and on Muse now get their
  instructions once per session, not with each message. The instructions are 20,000 to 30,000
  characters, so each message used thousands of extra input tokens. OpenBot sends the instructions
  again when they change, such as after a new memory, after the agent compacts its context, after a
  failed message and after a restart. An agent that does not report its context size gets them
  again every 10 messages.
- A routine run in an agent's own chat now starts its own provider session, so it uses fewer
  tokens. Before, each run sent the whole chat context again. The run reads the newest chat
  messages, and its answer still shows in the chat. The agent reads the answer with its next
  message. A task, channel or messaging routine runs as before.
- A phone notification of a question, an approval or a browser step in a channel names the agent
  and the channel, as on desktop. Before, it named only the agent. A phone app from before channels
  came back still gets the agent name.

### Fixed

- Images that an agent on a remote server attaches to a reply now show one by one. Before, a group of
  large images stayed as empty gray tiles until all of them arrived, and on a slow connection they
  sometimes did not show. A tile now shows a spinner while its image loads.
- An agent now says that Marketplace has no app for a service, such as Whoop. Before, the agent said
  that it left a card to connect the app, but the chat showed no card.
- Find and start a Codex CLI that npm, Volta, Bun or pnpm installed when you open OpenBot from
  Finder, the Dock, or a login item. Before, OpenBot reported that Codex was not found or could not
  start, because the CLI did not get your shell `PATH`. OpenBot now reads the `PATH` of the shell in
  `$SHELL`, such as bash or fish, not only zsh.
- Say whether the downloaded copy or your own copy of Codex or Claude could not start, instead of
  always asking you to reinstall OpenBot.
- On Windows, pick a runnable file when `where` finds a Claude, Codex or other CLI with more than
  one extension.
- Usage analytics now count the tokens and the estimated cost of task turns. Before, a turn in a
  task stored no usage, for all providers. A Codex task that started before this version counts
  from its next request. A Grok task from before this version can count its earlier usage on its
  next turn.
- Codex usage now includes cache writes at the cache-write price. Before, a cache write counted as
  uncached input.
- A Codex request with 200,000 or more input tokens now gets an estimated cost. A request with more
  than 272,000 input tokens uses the long-context price.
- A Grok update with less than 200,000 input tokens now gets an estimated cost when the session has
  more. Before, the session total had to be less than 200,000.
- GPT-6.1 Sol, GPT-6 Sol and GPT-5.5 now have an estimated cost.
- Delete an agent on Windows on the first try. Before, a delete often failed with "The agent data
  could not be removed completely" when the agent had saved a memory or had a profile change in the
  last 10 minutes, or when its Claude process took more than 1.5 seconds to stop.
- Agent chats stay at the latest message while a turn runs. Before, the view jumped up and down, and the bottom was hard to reach.
- A chat link to a folder in the shared directory now shows the folder in the file manager. Before,
  the link showed "Shared path is not a file." On a remote server, the error now says that the
  path is a folder (#2700).
- An agent question that lets you pick more than one option now shows check boxes and a Submit answer button. Before, the first option that you clicked sent the answer. This works in the desktop app, in a joined desktop and in the web client of a server with this version.
- An agent question that waits for your answer now shows again after the window reloads. Before, the question card went away and the agent waited with no way to answer.
- A channel task moves to the agent's backup model at a usage limit, as the agent's chat does. The
  channel shows the model switch.
- After a provider change, an agent's channel conversations get a handoff on the new provider.
- A hidden lead no longer routes channel work, and hiding an agent gives its queued channel work
  back to the channel.
- When an OpenCode model needs a sign-in that its provider does not have, the chat no longer shows
  only "Authentication required: provider authentication required". The error names the provider
  and tells you what to do: choose a model with the Free label, paste an OpenCode Go key in the
  OpenCode settings, or run `opencode auth login` in a terminal. The README says which OpenCode
  models need no sign-in.
- When ChatGPT refuses requests because they come too fast, the agent now shows "Too many requests.
  Wait a moment, then try again." The raw Codex text "exceeded retry limit, last status: 429 Too
  Many Requests" no longer shows.
- On Windows and Linux, Ctrl+W in the main window no longer closes OpenBot when no browser tab is
  open. With "Keep OpenBot running in the background" off, it quit the app with no question.
- Answer the approval cards that already wait for an agent when you give it Full access, press
  Always allow, or an admin changes its permission from another computer. Before, those cards stayed
  open until you answered each one.
- Run a Codex MCP tool without a card when the agent has Full access, also when the tool is set to ask
  every time in Codex. Computer Use still asks.
- Stop showing `thread not loaded` in a Codex chat at each start. OpenBot now reads the history of an
  agent on a second Codex account through that account, and ignores a session that Codex has no saved
  history for.
- Start a new Codex session when Codex has no saved history for the old one. Before, each message to
  that chat failed.
- Agent and channel instructions longer than 2,000 characters no longer get cut silently. Before,
  a long paste dropped the rest of the text with no warning. Now the field keeps all the text, shows
  a character count near the limit, and shows an error when the text is too long. The instructions
  are not saved until you shorten them.
- Claude usage now counts each turn once. Before, the first turn after OpenBot resumed a Claude
  session, such as after a restart or 10 minutes of idle time, counted all the earlier turns of the
  session again. The Usage view and its estimated cost showed too many tokens for Claude agents.
  Usage that was recorded before this version stays as it is. The first turn after a resume has no
  estimated cost.
- When Google reports that a Gemini usage limit is reached, OpenBot no longer calls it a rate limit
  and no longer tells you to wait a few minutes. The message now says that the limit can be for one
  model, so the usage page of your plan can still show room, and it keeps the reset time from Google.
- The menu that changes a routine's trigger now fits the space in the window and scrolls. Before, on
  a short window, such as one close to the Windows taskbar, the bottom of the menu was cut off and
  you could not reach Webhook.
- Only the owner and admins can restore a deleted channel from another device, as they are the only
  people who can delete one. Before, the computer let a member restore it.

## [0.47.1] - 2026-10-21

### Added

- Settings > Voice has a new local dictation model: **Underdog Bark 3.0 Plus**. It is fast and
  recognizes English only. It writes mostly lowercase text, with little punctuation. OpenBot
  downloads it (about 685 MB) only when you select it.
- Roles in Server settings let an owner or admin choose the agents that members can use. Each role gives each agent one level: No access, Can view, Can chat or Can manage. A member gets the highest level of Everyone and of their roles. Owners and admins can use all agents. The role menu of each member on the Members page gives the roles and the server role.
- Import your Hermes Agent profiles in Server settings › Import. Each profile becomes an agent with its persona, memories, skills and scheduled jobs. There are three ways, as for Grok Bot:
  - **Read this computer:** OpenBot reads the Hermes folder and shows every item, and why an item stays in Hermes, before anything changes. Skills with scripts and MCP servers import only when you allow them, and MCP servers are added turned off. When you import a profile again, its agent is updated, and no second agent is added.
  - **Install with a command:** type the `/skills install` command in a Hermes chat, send `/openbot-export`, and choose the `.zip` file that Hermes saves.
  - **Set it up yourself:** add the export skill file to Hermes by hand, then do the same steps.
- Keys in `.env` and `auth.json` are never copied.
- Server settings › Import now starts with where your agents are now: Hermes Agent, Grok Bot, or another OpenBot computer.
- Select text in a file that the side panel shows, then quote it or ask the agent to change it. The quote names the file and, in a text file, the lines. Click the quote to open the file at the quoted passage.
- Oh My Pi (`omp acp`) is now in the list of known agents when you add a custom agent, and the
  agent scan finds an installed `omp` command.
- Ask an agent to add an MCP server, for example "Add this MCP server: https://example.com/mcp". The agent connects to it, tells you its tools or the error, and you approve each change unless the agent has Full access. When the server needs a sign-in, a Sign in card shows in the chat; press Continue after you sign in, and the agent tests the server again. Keys stay in Server settings, MCP: the agent never asks for them in the chat. Agents can also turn MCP servers on or off, test them and remove them when you ask.

### Changed

- Settings > Providers is now a short list in two groups, Connected and Other providers, with a search field. Each row shows one line, and a badge only when the provider needs you.
- Each provider has its own page with its accounts, sign-in, API key, version, restart, diagnostics and on/off switch. Open it from the list; "Providers ›" in the title goes back.
- An account that is low on usage shows a badge with the amount left. Click it to see all of its limits.
- The default provider for new agents is now one menu at the top of the list.
- Custom endpoints have their own page, where you add and remove them.
- A member can no longer change an agent's settings when a role gives that member less than Can manage. On a server with no roles, members can use all agents, as before.
- The Quote button in the selection bar shows its shortcut in its tooltip.

### Fixed

- The Tasks page keeps the agent that you chose last on each server. Before, it went back to the first agent each time you opened the page.
- The agent menu on the Tasks page scrolls when a server has many agents. Before, agents below the bottom of the window could not be chosen.
- Icons in buttons with text are now the size of the text, not larger.
- OpenBot now offers new Pi releases. Before, the update check could not read Pi's release tags, so
  Pi stayed on the version that came with OpenBot.
- In Discord, the agent now gets the images and files of earlier messages. A new conversation also
  gets the channel's messages from the 15 minutes before it. Before, "@OpenBot make an issue" after
  an image that another person posted without a mention did not see that image, and the agent could
  act on an older request.
- Keep each agent's provider session when OpenBot stops through a signal, as a terminal, `systemd` or Docker sends it. The Computer Use driver stopped from the same signal and made every agent start a new provider session at the next launch, which lost the provider's own context.
- The Composio listing now connects with a Composio Connect link (`https://connect.composio.dev/mcp`) and its API key. Before, the key went in a header that Composio Connect does not read, and the connection failed with "This server asks for a sign-in".
- A server that refuses a pasted key now says to check the key. Before, it said to sign in.

## [0.47.0] - 2026-10-21

### Added

- The model picker has a **Fast** switch for Codex models that have a fast service tier. When it is
  on, the agent asks Codex for the fast tier and the picker shows "Fast" next to the model.
- Attach ZIP archives in chat. The agent gets the archive unchanged and can extract it. An agent can
  also send a ZIP archive back, and you can download it from the chat. A remote host must run this
  version of OpenBot to accept ZIP archives.
- Add Inception as a provider, with the Mercury 3, 2.5 and 2 models. Select Connect on the Inception
  row and save an Inception API key. Inception runs in the Pi CLI that OpenBot downloads, so download
  Pi first. OpenBot keeps the key encrypted on this computer and does not change Pi's own settings.
  Inception agents stay on this computer and are not shown to team members.
- The desktop app and the web app show a notification when an agent needs you to finish a step in the browser, such as a sign-in or a code. Before, only the phone and the MacBook notch showed it, and the phone stayed quiet while you used the desktop app.
- A message or a routine run that cannot start now shows a notification on desktop, web and phone, as a turn that stopped with an error does.
- Read the SKILL.md of a skill on a joined server and in the web client. The text comes from the
  host. Before, a local skill or a folder skill showed only its description, and a skill that was
  changed on the host showed the marketplace text.
- On a joined server, a skill marker in the chat opens that skill in the agent settings.

### Changed

- OpenBot now installs OpenCode 2 (2.1.1) as its own OpenCode CLI. Your threads keep their OpenCode
  sessions.
- When you mute this computer's server, or set its notifications to Nothing or Only when it needs me, your phone now gets the events that the desktop does not show. Before, these events reached no device while you used the computer.
- Mute and the notification level of a server now also stop the agent sounds on desktop, as they do on web.
- You can change the model and effort of an agent while it works. The running turn keeps its model,
  and the new model starts with the next turn. An "After this turn" badge beside the model picker
  shows that a change waits. Before, the picker was locked until the work finished. A change of
  provider or account still waits for the work to finish.
- Server settings: **Publish this server** is now in **Members**, above the invitations. General
  keeps the server name, logo, and preferences. The server address row is removed: people join with
  an invitation, not an address.
- You can publish a server before you name it. OpenBot gives it a name from your account, such as
  "Ann’s server". You can change the name in General.
- When product analytics is on, a completed agent turn now also sends the token counts that the
  provider reported for that turn: uncached input, cached input, cache write, output, and total.
  It also sends these counts for each provider and model that the turn used, such as a subagent's
  model.
  When the provider reported no usage, it sends that the usage is unknown, not 0. No message
  content is sent. You can turn product analytics off in Settings → General → Permissions → Share
  product analytics.
- Product analytics now also counts the hosted server plans, plan and member limits, license
  steps, contact sales links, provider usage limits, setup steps, connectors, agent templates,
  phone connection, channels, server export and import, help links and the Usage view. It sends no
  names, message text, IDs, links, prices or email addresses.
- Licenses now appear in the billing analytics of the account service, with the number of users.
- The web app at `openbot.run/app` now sends the same product analytics as the desktop app. Its
  setting is now **Share product analytics** in account settings.
- When you turn off **Share product analytics**, the app sends one last event that records the
  change. Then it stops all analytics.

### Fixed

- Center the hero of the openbot.run download page, as on the other site pages. The title is now
  the same size as the other page titles, so it shows on one line on a wide screen.
- A remote session stays connected when Signal restarts and the account service is slow to answer.
  Before, the session closed and the device showed it as offline.
- After a Signal restart, OpenBot computers and devices no longer all connect again at the same time.
- OpenCode setup no longer fails with "could not activate the managed CLI" on a computer where
  OpenCode 2 is already installed. When OpenBot uses an older OpenCode CLI that cannot open the
  database of OpenCode 2, setup now tells you to update OpenCode to version 2 or later.
- With OpenCode 2, an OpenCode thread opens again after a restart, also while OpenCode is still
  starting.
- With OpenCode 2, the model picker shows the OpenCode, OpenCode Go and custom endpoint groups by
  their names.
- Remote chats no longer show a permanent chat error when a background queue refresh times out. The last queue stays visible until the next update. Failed queue actions still show an error.
- The Voice select in Settings → Voice → Spoken replies now shows the voice you choose. Before, it kept the name of the previous voice until Settings opened again.
- Sign in to an MCP server now reports an error when the sign-in information of the server cannot
  be read. Before, the press ended with no page and no words, and the row kept the result of the
  earlier test.
- A reply quote on desktop shows the Markdown of the original message: headings, bold text, code,
  lists, links and code blocks. Before, it showed the raw marks, such as `##` and backticks, on one
  line. The quote now shows up to four lines, in the composer and in the sent message.
- On a phone, the web side panel shows its tabs in a row under the chat header. Before, the tab row
  covered the agent name, the model picker and the side panel button, and with the pane list open
  the side panel button did not respond.
- A Codex chat no longer shows the error "Falling back from WebSockets to HTTPS transport" when Codex changes its connection. The reply continues. If the reply then fails, the chat still shows the error.
- Center the agent avatars in the connectors list of Server settings and on the Slack, Discord and
  Telegram connector pages. Before, each avatar stood about 3 pixels lower than the row text and
  the arrow.
- OpenBot now keeps your sign-in, API keys and other secrets on Linux desktops such as Hyprland,
  Sway, i3 and LXQt when a Secret Service (such as GNOME Keyring) runs. Before, it asked you to sign
  in on every start, and it could not save a pasted API key.
- Keep your Codex and ChatGPT thread lists clean. When OpenBot starts a new Codex session for an
  agent, for example after you change its tools or reset its context, it now archives the session
  that the new one replaces. Before, each replaced session stayed in your Codex history as a row
  that starts with "Continue this OpenBot conversation." The agent's conversation in OpenBot does not
  change.
- Pi agents keep their OpenBot tools, browser included, in new conversations. Pi also shows the
  OpenBot tools with their real names, so a model can find them.
- A routine run in the chat now animates once. Before, its row and its steps, such as "Invoked" and
  "Started", could animate again when the run changed state, when two runs overlapped, or after a
  reload.
- When an OpenCode model cannot read a file or image in the chat, OpenBot now tells you to choose a
  model that can read files, in a yellow notice. Before, a red error said that the provider failed
  and that you must try again later, but each new message failed again until you changed the model.
- A task that needs your approval no longer looks stuck in "Making the requested changes…". The task panel
  on desktop and on the web shows the approval with Allow and Deny, and the task says "Waiting for your
  approval". An approval of a task no longer hides an approval of the agent's chat.
- On Discord, OpenBot reads the images and files of the message that you reply to. Before, it read
  only the text of that message, and a message with only an image gave no context.
- A notification for a question, an approval or a browser step now goes away when the request is answered or cancelled, also from another device. Before, it stayed in the Notification Center.
- When the ChatGPT sign-in of a server had expired, a sign-in with a code from the web client or the phone stopped a few seconds after the code appeared. The code now stays valid until you enter it.
- Failure reports from the desktop app and the local host were dropped before they were sent.
  They now reach the analytics service.
- Check saved secondary ChatGPT and Claude accounts when their provider starts, so accounts can reconnect after an app reload or CLI update without removal and a new sign-in.

## [0.46.0] - 2026-10-20

### Added

- OpenBot can read replies aloud on this computer. Turn on Read replies aloud in Settings › Voice ›
  Spoken replies. When you dictate a message, its reply is read aloud in the language of the reply,
  in 31 languages. Dictate again, or send a new message, to stop it. Choose one of ten voices and
  press Listen to hear a sample. The Supertonic 3 voice model downloads once, about 145 MB, and no
  text or audio leaves the computer.
- A bar above the composer shows the reply that is read aloud, with a Stop button.
- Each agent message has a Read aloud button. Press it again to stop reading.
- Talk to an agent in the Voice pane of the side panel. Open it from the side panel or from the "+"
  menu of the composer. Speak, and stop talking to send the message. The agent reads its reply
  aloud, and then the pane listens again. The first time, the pane downloads the voice models. A waveform under the agent moves with your voice, so you
  can see that it hears you, and with the agent's voice while it speaks. Mute, Interrupt and End
  control the conversation.
- A message that you speak in the Voice pane has a voice player in its bubble, with the waveform
  and length of your recording. Play, pause, or click the waveform to go to a different part. The
  agent gets only the text, and the recording stays on this computer. The reply to a spoken message
  has a player too: it reads the reply aloud with a timer, and you can pause and resume it. After
  one full reading, the reply keeps its audio until you close OpenBot: its player shows the waveform
  and length, plays again at once, and you can click the waveform to go to a different part.
- The Voice pane works with an agent on a remote server. The spoken reply runs on this computer,
  speech recognition uses the voice model you chose in Settings › Voice, and only the text goes to the
  server. A message that you speak to a remote agent
  has no voice player.
- When the server of the agent disconnects, the Voice pane stops listening and tells you. It listens
  again when the server connects. When a spoken message cannot be sent, the pane tells you and
  listens again; the message stays in the chat with Retry, Edit and Dismiss.
- Voice recordings use WebM/Opus, about 4 KB a second. They show in the Storage tab of Server
  Settings, where you can delete them, and they are part of a data export.
- The production desktop app sends OpenPanel events for the Voice pane, spoken replies, the voice
  model download and the spoken reply settings: counts, times, lengths and results only. It never
  sends what you said, the reply, or audio.
- Invite users to the OpenBot community from a card at the bottom of the sidebar, in the desktop app
  and the web client. "Join the Discord" opens the Discord server, and the X button opens the OpenBot
  account on X. The card stays closed after you dismiss it. On desktop, it shows after you dismiss
  the mobile app card.

### Changed

- Set "Memories per agent" only in Server settings → General → Agents, for this computer and for
  joined servers. App Settings no longer shows it. Before, the App Settings value applied only to
  agents on your computer, so a server's agents could stop at 64 memories while App Settings showed
  a higher limit. Global search also finds "Memories per agent".
- The top of the openbot.run home page no longer shows a grid behind the title.
- In the web app, an account with no server now sees Create a hosted server as the first action.
  Download OpenBot and Join with invitation are still there.
- Show the License section in Billing also when licenses are not for sale. A purchase then shows a
  message with the address to contact: licenses@openbot.run.

### Fixed

- Keep the saved account sign-in when OpenBot cannot read or save it at one start. Before, OpenBot
  deleted it, and you had to sign in with an email code again after the next restart or update.
  OpenBot now writes the reason to `logs/account/account.log` in its data folder.
- Keep a question from a ChatGPT agent open until you answer it. Before, with GPT-6 models the
  question often expired after about 20 seconds.
- On Windows and Linux, "Keep OpenBot running in the background" now works. When it is on, closing
  the window hides OpenBot, and an icon in the system tray opens it again or quits it. Before, the
  window closed OpenBot, and the switch was off again after a restart.
- "Launch OpenBot at login" now opens OpenBot when you sign in to your computer. Before, the switch
  did nothing and was on again after a restart.
- OpenCode agents no longer fail on each message with "OpenCode service failure" when OpenCode
  cannot read the agent's session, for example a session that another OpenCode version wrote. The
  agent now continues in a new session with its conversation.

## [0.45.0] - 2026-10-20

### Added

- One OpenBot server can connect more than one Slack workspace or Discord server. Settings › Connectors shows "Add workspace" or "Add Discord server" after the first one is set up. One Slack Orchestrator answers every Slack workspace, and one Discord Orchestrator answers every Discord server, as one Telegram Orchestrator already answers every Telegram chat.
- You can choose which Discord roles can use OpenBot in each Discord server. OpenBot ignores a mention from a member who has none of the roles. With no role chosen, everyone can mention OpenBot, as before.
- The context meter in the composer has a New chat button. The earlier messages stay visible, and
  each new message sends less context.
- An agent can start a new chat for itself with the `start_new_chat` tool, for example from a
  routine. It saves notes first. Turn on "Agent starts new chats" in the agent's settings to allow
  it. It is off by default.
- Ask side questions in the web client and on joined servers. Before, side questions worked only on
  the computer that runs the agent. The server must have this version of OpenBot.
- An agent can show its plan before a long task. Turn on "Show the plan before long tasks" in the
  agent's settings. The agent then posts a short card with its plan and Start, Cancel, and sometimes
  a smaller option. The agent starts after 10 s if nobody answers. It does not show the card for
  quick answers. The setting is off by default.
- The chat shows the subagents that a Claude or Codex agent starts. One card for each turn shows how
  many subagents finished, what each one does now, and how long it took. Click a subagent to see its
  task and all of its steps in the side panel.
- When you make a routine on this computer or on your own remote computer, OpenBot offers an OpenBot
  server, which runs routines 24/7. The offer shows after an agent's turn ends, at most once in 30
  days. The routine list and the offline notice of a remote computer also show the offer. "Not now"
  hides it for longer each time.
- Settings → Billing has a License section for work at a company. Buy a license for 5 to 25 users,
  in EUR, USD or PLN. See who uses it, change the number of users, update the payment method, or
  cancel it. A larger team can contact us.
- A license limits the people on the owner's servers. When it is full, a new person cannot join. The
  server owner sees the extra price at a new invite and can add 1 user.
- A member of a server whose owner has a license sees that the license covers them.

### Fixed

- On Windows, OpenBot now finds an OpenCode that you installed with the OpenCode installer or WinGet. Before, it said that OpenCode was not downloaded.
- On Windows, the Download button of a provider works again after a shutdown or sign-out that was cancelled. Before, each click failed and showed nothing.
- In Settings, a provider download that fails now shows why. Before, the Download button did nothing.
- The Cline model picker shows Cline's free models, such as MiniMax M3.1 Flash, MiMo V2.6 Flash and Muse Spark 1.3 Contributor. Before, only the Cline CLI showed them.
- A Cline agent runs on the model that you select. Before, the agent stayed on Cline's default model.
- Steer on a remote server now shows why it did not steer when the provider, such as OpenCode or
  Grok, cannot steer a running turn. Before, it showed only "Request failed". The message still
  stays in the queue.
- When you mention OpenBot in a Discord reply to someone else's message, OpenBot now reads the message you replied to. Before, OpenBot said that it could not see what "this" was.
- The delete server dialog keeps its height and position when you change between "At period end"
  and "Immediately". Before, it moved because the description and details have different lengths.
- A Claude agent now makes a routine in OpenBot when you ask for one. Before, it sometimes used
  Claude's own `schedule` skill and made a claude.ai cloud routine that OpenBot did not show.
  Claude's own scheduling tools are now off in OpenBot.
- A chat with unread messages now opens at the "NEW" divider, with the last read message above it.
  The divider stays while you read and goes when you leave the chat. Before, the chat opened at the
  newest message and the divider went away at once, because the open chat marked the messages read.
- An OpenCode agent now uses the OpenCode Go key that you paste into OpenBot. Before, an old key that `opencode auth login` saved took its place, so a turn failed with "This API key has expired" again after you replaced the key.
- An expired OpenCode key now shows "Your OpenCode API key expired" with an Update key button that opens the provider settings. Before, the chat showed "Internal error".
- A Workspace-only agent now uses a new provider key on its next turn. Before, it could keep the old key until it was idle for 10 minutes.
- A cloud server that started again soon after it stopped sometimes stayed at "Starting Cloud
  server" with `signal/host_unavailable`. The machine continued from memory, and OpenBot did not
  start on it. The account server now starts OpenBot after such a start.
- The update banner now shows the full button label in every language. Before, a long label such
  as "Uruchom ponownie" (Restart) in Polish went past the button and the banner cut it off. In
  Polish, the button now says "Restart". In Turkish, the "managed by host" button now says "Ana
  makine yönetiyor".
- Renew in Settings → Billing works again for a server plan that you cancelled. Stripe refused the
  request before.

## [0.44.3] - 2026-10-19

### Changed

- The rail on the right side of a long chat now shows your messages, not the days. Point at the rail
  and select a message to go to it and to the replies under it. The rail is there when a chat has
  two or more of your messages.
- The rail of a long chat stays in view when you do not scroll. When you point at it, the chat behind
  the titles is blurred, so the titles are easier to read.

### Fixed

- The results of the settings search now show their text on the left. Before, the section name and
  the row title of each result were in the center of the row.
- The rail of a long chat no longer shows days out of order or the same day two times.
- The rail of a long chat stays smooth while you scroll, and its titles no longer come in slowly in
  a long list.
- "Side question" in the composer "+" menu now opens the side question pane. Before, a click with
  the mouse closed the menu and did nothing.
- An agent template that contains the OpenBot skills `openbot-data`, `openbot-site-hosting` or
  `openbot-skill-creator` installs again. Before, the install stopped with an error, because the new
  agent already has these skills. A new publish no longer adds these skills to the template.

## [0.44.2] - 2026-10-19

### Fixed

- Show the whole tab menu in the browser view. Before, a right-click on a tab showed only the first
  rows of the menu, and the page covered the other rows. Now the page is hidden while a menu of the
  browser view or the address suggestions are open, and it comes back when the menu closes.
- The page of a shared agent, and the dialogs that add or publish an agent in the desktop app and the web app, show headings, lists and links in the agent's instructions. Before, they showed the Markdown marks, such as `##` and `-`, as text, and the page centered the instructions.
- You can now scroll up in a chat while the agent works on a reply. Before, a short scroll up with a
  trackpad or a mouse wheel moved the chat back to the newest text each time the reply grew, so the
  chat jumped and you could not read the earlier messages. The chat follows the reply again when
  you scroll back to the bottom or send a message.
- Let an agent open pull requests and post comments with `gh` when GitHub is not connected. Before,
  the agent refused and asked for GitHub MCP tools that it did not have.

## [0.44.1] - 2026-10-19

### Added

- Set "Memories per agent" for a joined server in Server settings → General → Agents. Before, the
  setting in App Settings applied only to agents on your computer, and agents on a self-hosted
  server kept the limit of 64. You must be an owner or admin, and the server must run this version.

### Fixed

- Start OpenBot when a power loss left the joined server list or the team server settings file
  empty. Before, the start stopped with the error "Unexpected token '". The damaged file stays
  beside the new one with a `.corrupt-<time>` name. OpenBot also flushes each settings file to the
  disk before it replaces the old one, so a power loss cannot empty the file.
- Name the damaged file when a settings file stops the start. Before, the error quoted the start
  of the file and did not say which file it was.
- Open the file panel for a local file link over 100 MB. Before, a click on the link showed the
  error "The file exceeds the 100 MB limit." and no panel opened, so you could not open the file,
  show it in the folder or save it. Now the panel shows that no preview is available and gives
  these actions. OpenBot does not read the file to show the panel.
- Let Claude agents run tools from Homebrew, `~/.local/bin` and other folders of your shell `PATH`
  when you open OpenBot from Finder, the Dock, or a login item. Before, the Bash tool and hooks
  reported `command not found`. An `env.PATH` in your Claude settings still wins.
- Keep the server and its members connected when an owner or admin changes the role of a member.
  Before, each change to Admin or Member disconnected the host and every connected member, and the
  server showed as offline until it connected again. Now only the member whose role changed
  connects again, with the new role.
- Show the full day tooltip on the status page. Before, the card cut off the tooltip of the first
  and last days.
- Run a message again to its end after the provider refused its first turn. Before, the second run
  of the message showed as interrupted while a Claude, ACP or Pi agent still worked on it. A Claude
  agent then refused each new message with "The Claude thread already has an active turn." until
  OpenBot restarted.
- Move the window by dragging the top row of the Tasks page. Before, only a thin strip beside the
  "Tasks" title moved the window.
- Open Settings again. In 0.44.0, Settings showed an empty page and the app stopped responding
  until it restarted.
- Update a provider CLI while the provider works on a turn. Before, Update and Retry showed
  "Update failed" with "The Claude CLI is working on a turn. Wait for it to finish, then update.",
  and you had to press Retry again later. Now the provider row shows "Waiting" and the update
  starts by itself when the current turn ends. New turns of that provider wait for the update.
  Cancel stops the wait.
- Let a Claude agent answer again after you switch it to OpenCode and back. Before, each message
  failed with "--resume requires a valid session ID", also after a restart. An agent that has this
  fault now starts a new Claude session and keeps its conversation.
- A provider account that is signing in now says to finish the sign-in in the browser, and its menu has Cancel sign-in. Before, the account showed "Connecting" with only Rename and Remove until the sign-in timed out.
- A new account sign-in on a joined server's host now stops the earlier one. Before, the earlier account could stay "Connecting" for up to 10 minutes, and Cancel could not stop it.
- Show the answer of a scheduled, script or webhook routine run one time in the chat of a Claude
  agent. Before, after OpenBot restarted, the chat showed the same answer two times in the run.

## [0.44.0] - 2026-10-18

### Added

- Agents can ask with interactive blocks: a confirmation with buttons, reply chips, a list to choose from, or a short form. The agent waits for your answer, as it does for a question. Every provider can use them, Claude too. The blocks show as cards in the desktop app and the web app, and you can skip one as you skip a question. Only the server owner or an admin can press a dangerous button, or answer a block that has one in words. A form can ask for a password or a key: the agent gets it, but OpenBot does not keep it on the card or in your answer. The agent can still repeat it in its reply or its thinking. If you cannot hold a button, press it and confirm in a second step. An app or a mobile app that does not show the blocks yet shows them as an ordinary question that you can answer.
- Settings > Profile shows the activity of this computer in the past year: a calendar of active days, the tokens, the messages, the peak day, the streaks, the providers, the models and the teammates that you use most.
- Share in Settings > Profile makes an image of your last six months. You can copy the image or save it as a file. The image stays on your computer until you send it.
- Add a Tasks page to the page rail, on desktop and on the web. Write a task, choose the agent, and send it; you can undo the send for 6 seconds. The page groups the tasks of all agents by what they need: Needs you, Working, Waiting and Closed. Click a task to open its conversation beside the list. On desktop, you can also dictate a task. A joined server shows the page when it supports tasks.
- Take over a browser tab from its agent at any time, and give it back with "I'm done". The agent waits while
  you control the page, then continues from a fresh look at the page.
- Right-click a browser tab to open a new tab to its right, duplicate it, move it, or close the tabs to its left,
  to its right, or all other tabs. Reopen a closed tab at its old place.
- The address bar suggests open tabs, pages you visited in this session, and a search as you type, and it
  completes a visited address.
- Stop a page that loads from the address bar. Back and Forward are off when the tab has no page to go to.
- In the full browser view, the keys of other browsers work: new tab, close, reopen, select a tab by number,
  next and previous tab, address bar, reload, back and forward.

### Changed

- Signing out of an MCP server, or removing it, now asks the server's authorization service to revoke the tokens.
- Agents no longer get the OAuth token of an MCP server that you signed in to. They reach the server through a local address in OpenBot, which adds the token to each call.
- Save on a new HTTP MCP server now tests it first. When the server asks for a sign-in, OpenBot signs in and then saves. When the server refuses the typed credentials, OpenBot does not save and goes to Headers.
- A web address pasted or typed into "Command to launch" now moves to Server URL and selects Streamable HTTP.
- Profile is now the second tab in Settings, after General.
- You change your photo and your display name in one Edit profile dialog, in the desktop app and in the web client.
- Reply on a message in a chat or a channel now puts the caret at the end of the message box, so you can type at once. Before, you had to click the message box first. Text that you selected in the message box stays selected.
- Agents with a long message history start queued work faster.
- The web app uses less memory when you open many long conversations.
- The full browser view shows every tab in its top row, with the address bar above the page. In a narrow window,
  one button with the tab count opens the list of tabs.
- The composer, the queue and the agent status float over the page in the full browser view, so you can talk to
  the agent of the tab while you look at the page. The agent's reply shows over the page and closes by itself.
- Select a tab of a different agent in the full browser view to open that agent's chat. The page stays open,
  and the floating composer sends to the agent of the tab.
- The card where an agent asks for a code or a password has a new design.

### Fixed

- Open the sign-in page when you click **Sign in** for an MCP server that shows its tools without a
  sign-in, such as the Google Sheets and Google Chat MCP servers. Before, the click did nothing, and
  the server stayed signed out.
- Connected devices in Mobile Connect now shows only the phones that can open this computer. A phone that you connected to a joined server no longer shows on a computer that it cannot open.
- Keep messages with unknown code language labels visible when a label is `constructor` or `__proto__`.
- Wrap a long agent reply inside its bubble when it names a file by a long path. Before, the text ran
  past the right edge of the bubble and was cut off, and the chat column could grow wider than the
  window.
- Remove temporary instance transfer ZIP files left after a restart when the next upload or export starts.
- Complete marketplace skill installation and refresh the agent runtime when the install receipt request fails after local files and the skill lock are saved.
- Prevent service restarts from interrupting a teammate file download while its input stream is still being written to disk.
- Routines now use the earliest next scheduled time when clocks move back. Some schedules skipped a run in the first occurrence of a repeated hour or missed a run when the clock moved back several hours.
- Reject malformed custom cron list and step syntax when saving a new or changed routine schedule. Keep saved schedules readable and editable.
- Keep all attached files when the file system treats different filenames as equal. Previously, one attachment could overwrite another and become unavailable.
- An MCP server that refuses a saved sign-in now shows "Sign-in needed" with a Sign in button. Before, its row looked signed in until a test failed.
- A background token renewal no longer registers a new OAuth client with the MCP server.
- Agents no longer get an MCP token that the server has already refused.
- An MCP token that expires during a long agent session is now renewed. Before, the agent kept the old token until its session restarted.
- After you sign out of an MCP server, or the server ends the sign-in, an agent that calls one of its tools now gets a message that tells it to sign in again in OpenBot.
- After you cancel a checkout from the desktop app, the billing page now says that the checkout was
  cancelled and that nothing was charged. Before, it said "Billing updated".
- The form to report a hosted site now has the site style and shows a clear result or error. Before,
  it had no style and showed raw data after you sent it. You can now type the site address when the
  form opens without one.
- "New URL" and "Turn off" for the routine calendar feed now ask before they stop the current URL.
  The panel also shows a loading state, a Retry button after a failed load, and a note when the
  agents cannot load.
- The routine calendar no longer shows channel routines that cannot open. Before, a click on one
  could leave a pane that loaded without end.
- The first-agent setup screen and the side-question panel now show in your language.
- When a side question gets no answer, the panel now says that it failed and has a Retry button.
- Reject custom cron numbers that are not plain decimal digits, such as `0x5`, `1e1`, `+5` or `5.0`, when saving a new or changed routine schedule. Keep saved schedules readable and editable.
- Complete the installation of a marketplace agent when the install receipt request fails after the agent is saved.
- When a setting does not save, a message now tells you why the switch went back. When settings do
  not load, the settings page says so and has a Retry button. Before, it showed default values.
- When OpenBot cannot read your saved setup at start, it now shows Retry. Before, it opened first-run
  setup.
- 1Password, Bitwarden, Slack, Discord and Telegram now show "Unknown" and Retry when their status
  does not load. Before, they showed "Not set up". A failed "Open app" for 1Password now shows an
  error.
- Slack and Discord now have Pause, as Telegram does.
- Disconnect for an account session now asks first.
- You can undo the delete of one memory.
- Each routine in the list now has Pause or Resume. "Delete now" shows that it is in progress.
- Failed actions in the browser picture-in-picture controls, the What's New link and the routine
  webhook status now show an error.
- The join, Slack, Discord, billing, site report and error pages on the website now have the same
  header, card and footer. The page-not-found page has its own title.
- The Slack and Discord connect pages now say what went wrong for each error and offer "Try again"
  and help when OpenBot does not open.
- The join page now says "server", explains how invitation links work, and has link previews.
- Download links on the website now open the download page. The footer now links to Teams and
  Contact.
- A shared agent that is no longer shared now shows a clear page, not a generic error.
- Hosted sites now show a branded error page in the browser, and their report link uses the correct
  account service address.
- The web app can now create a hosted server when you have no server to connect to.
- Stop the provider processes when OpenBot quits while it changes a provider key, updates a provider CLI or reconnects a provider. Before, the new process, or the process that it replaced, could continue to run after OpenBot stopped.
- The app and the web app now use "server" for a computer that you connect to or join. Before, they
  also said "host" or "computer".
- Error labels in a conversation now say what failed, for example "Could not send your answer".
  Agent errors now tell you what to do next.
- Errors in the agent registry now name the action that failed: search, install, update, remove or
  cancel. Before, all of them said "The registry operation failed".
- The join, Slack, Discord, billing, site report and error pages on the website now show in the
  language of your browser.
- More text in the web app, the sidebar, the marketplace and the Cobrain listing now shows in your
  language.
- Settings search now finds settings on every tab. A result opens the tab and marks the setting.
- Icon button tooltips now use the app style and close with Escape. Before, some used the plain
  system tooltip.
- A button that is busy now keeps keyboard focus.
- All dialogs now use the same dimmed background.
- The web client and a joined desktop can now read the queue of an agent with a long history on a server. Before, after some weeks of use, the queue answer was too large for the connection, and the chat showed a "response too large" error (#2368).
- Show the correct reason when a direct message cannot go to its recipient, for example when the
  member left the team or is disabled. Before, the server answered "Request failed." and wrote an
  error to its log.
- A message no longer stays "running" after its turn ended with an error. Before, a failure at the end of a turn or during the recovery after a restart could keep the message running, and the agent's next messages waited in the queue. Stop did not clear it. Now the message ends as interrupted or failed, the next message starts, and Stop clears a message that no provider runs.
- `PRIVACY.md` now lists the hosted site files, marketplace skill bundles and site reports that the account service stores.
- Opening a server invitation link again no longer disconnects every member of the server. A
  member keeps their role, and a removed member cannot join again with an old link.
- When a provider process stops, agents on other processes keep their browser controls, and a
  compaction of the stopped process shows as failed instead of staying hidden.
- Signing out, or ending a session from a phone or the web, now also closes the live browser view
  of that session.
- The Live Activity updates that OpenBot sends to your iPhone show a link that an agent reply writes
  in angle brackets, such as `<https://example.com>`. Before, the update removed the link.

### Security

- An MCP sign-in now stops an OAuth answer that is larger than 1 MiB or slower than 20 seconds.
- A public MCP server can no longer send its sign-in to an OAuth endpoint on a private network.
- A member that the owner or an admin removed could rejoin a server with an invitation or a team link from before the removal. Now that member needs a new invitation or a reactivation. A member who left by their own choice can still rejoin with an earlier invitation. A member who left before 18 October 2026 needs a new invitation, because OpenBot did not record before then who ended a membership.
- An invitation from an admin stayed valid after the admin left, was removed or was demoted. Now it closes, and it no longer counts against the invitation limits.
- If the public ticket key set had a private key by mistake, `/.well-known/jwks.json` published the private key. Now it publishes only the public members.
- A checkout return address that starts with `//` or `/\` could send the browser to another site. The account server never made such an address, but now it refuses one.
- A hosted site address such as `/constructor` made the site router read storage for a file that does not exist. Now the router finds only the files of the site.
- A request with no Cloudflare client address got its rate limit key from `X-Forwarded-For`, which the client sets. Now only the Cloudflare address sets the key.
- An IPv6 client got a new per-address rate limit for each address in its /64. Now all addresses of one /64 share a limit.
- Signal read the full body of a Slack request or an account event before it checked the size. Now it stops reading at the limit and answers 413.

## [0.43.0] - 2026-10-17

### Added

- Add "Join the Discord" to the Help menu of the page rail, on desktop and in the web app. It opens
  the OpenBot Discord community in the browser.
- You can hide an agent that you do not use now, and keep it. Select "Hide agent" in the agent menu. The agent moves to the "Hidden" section at the end of the agent list. Its thread, files, memories, settings, section and pin stay. A hidden agent does not run its routines and does not get new messages. Messages that are already in its queue wait. Select "Restore" to put the agent back in its section. Routine runs that it missed while it was hidden do not run. The hidden state is the same on each device that shows the server. On a joined server, only an owner or an admin can hide or restore an agent.
- Add a Month view to the Schedule page. It shows the runs of each day of a month in whole weeks,
  with three runs on each day and a count of the other runs. Select a day or the count to open
  that day.
- Add a "Provider runtimes" item to Clean up on the Storage page of this computer. It removes old
  provider CLI versions at once, and it does not wait for the automatic cleanup.
- Show what fills a Claude agent's context in the context popover of the composer: the system
  prompt, memory files, tools, skills and subagents, tool calls and results, messages, and free
  space. The counts are Claude's own estimates and need no extra model request. Other providers
  still show only the total. (#1635)
- On the website, when the agent network fills the frame, click an agent to grow a new network
  from it.
- On the website, click the OpenBot logo in the agent network to send a signal to the agents.
  Each click shows one of three signals at random.
- On the website, the agent network has easter eggs. Type "hello", "party", "sudo" or the Konami
  code, click the hub quickly many times, or leave the page alone until the agents fall asleep.
  Each reaction chooses its words and signals at random. Reduced motion turns the easter eggs off.
- On the website, agents in the network chat about their work when you click the hub, and when a
  network that you regrow is complete.
- Set the size of the virtual display that computer use reads on a self-hosted server, with
  `--display-size` at the install or `OPENBOT_DISPLAY_SIZE` in `/opt/OpenBot/hosted/openbot.env`,
  and in Docker with the `OPENBOT_DISPLAY_SIZE` variable. The default stays 1280x800.
- Ask the agent a side question from the composer "+" menu. The agent reads the chat and answers in the side panel. The question and the answer do not go into the chat, and closing the tab deletes them. Side questions work only on the computer that runs the agent.
- Add a public status page at status.openbot.run. It shows the state of sign-in, connections,
  hosted servers, desktop update downloads and the Marketplace, 90 days of history, incidents and
  planned maintenance. It has an RSS feed, and the site footer links to it.
- Click the quote in a reply to go to the original message. The chat scrolls to it, loads older
  history first when necessary, and highlights the message for a moment. "Back to the reply" takes
  you back. When the original was deleted, the reply says "Original message not available".
- Quote selected text from a chat message in a new message. Select the text and choose Quote, or press
  ⌘⇧. on macOS or Ctrl+Shift+. on Windows and Linux. The quote goes into the composer as a chip at the
  caret, and one message can have more than one quote. Click a quote to go to the quoted text, which
  shows highlighted. The agent gets each quote as a Markdown block quote.
- The status page sends signed webhooks for new incidents, updates, maintenance and service check
  changes to the tools of the OpenBot team, with retries for 11 hours. Slack and Discord formats
  are available. The feed stays the public way to follow the page. (#2335)
- `openbot-cli` runs a task on an agent from a terminal or a script and can wait for the answer. It also changes an agent's model, reasoning effort or provider account, and starts a new chat with an agent. It uses the Local scripts API, so only agents with **Local scripts** on can be used. When OpenBot restarts during a wait, the command continues the wait. See `docs/automation.md`. Thanks to @NatanPimentel.
- The Local scripts API has three new routes: `GET /v1/agents/:agentId/deliveries/:deliveryId` gives the state of a sent message and the turn's answer, `POST /v1/agents/:agentId/settings` changes the model, reasoning effort, provider or provider account, and `POST /v1/agents/:agentId/context/clear` starts a new chat, the same as **New chat** in the agent's settings. A change that the agent's state or the listed models refuse answers `409` with the reason.

### Changed

- Show a honeycomb of animated agent faces on the website, behind "Meet your first teammate" at the
  end of the home, news, guide, article and changelog pages. A blur under the text keeps it easy to
  read. Each face blinks, and the face under the pointer looks at it.
- Message search in a chat and in the global search is faster on a long chat history. It reads the stored messages one time per search, not two times.
- Published sites open faster. The site server now reads the block state and the site address list
  at the same time. Before, it read them one after the other on each request.
- The app demo on the home page and the web client download only the language that they show. Before, they downloaded all ten languages, about 1 MB, before they started.
- The home page loads less code from other pages of the site, so it shows sooner on a slow connection.
- The Marketplace opens as a page of the window, as Schedule, Usage and Settings do. Its title is in
  the top row and the page rail shows that it is open. Escape goes back one view, or closes the page.
- The buttons of the page rail show their names in a tooltip at their right. The tooltip opens and
  closes with the motion of a submenu, and it also opens when you move to a button with the keyboard.
- When you move the pointer along the page rail, one tooltip moves from button to button, as a
  submenu does. The usage card of a provider moves in the same way.
- In the web app, Settings and Server settings now open as pages of the window, the same as in the desktop app. The page rail marks the page that is open.
- The web app page rail now has Schedule. It shows the routine calendar of the connected server.
- The Help menu of the web app now shows the newest release notes.
- Delete the Slack, Discord or Telegram Orchestrator when you disconnect its connector. Before, the
  orchestrator stayed in the sidebar with no connector. The Telegram Orchestrator goes with the last
  linked chat. When no agent is left in the Integrations section, the section goes too. The
  disconnect dialog tells you this before you confirm.
- On the website, some agents in the agent network are larger leads with a team of small agents
  around them.
- Shorten button, tab, menu and badge labels in all 9 translations, so that each label fits on one
  line. For example, "Retry" is now "Wiederholen" in German and "Ponów" in Polish.
- Translate the text that showed in English in all 9 translations, such as the task panel and
  settings transfer.
- Admins can now change a member's role, remove a member and end a member's session, as the owner
  can. Nobody can change or remove the owner.
- The web app downloads less code before it shows the sign-in page and the workspace. It loads math formulas, Schedule, routines and server setup only when you open them.
- A streamed reply in the web app uses less processor time in a long conversation. When you go back to the web app window, it no longer reads the whole server again if it read it in the last 30 seconds.
- The web app uploads and shows large attachments faster.
- On Windows and Linux, the main window no longer shows the menu bar under the title bar. Menu
  shortcuts work as before, and the Alt key shows the menu bar.
- Set what an agent may do with one Permissions setting in its agent settings: Workspace only, Ask
  first or Full access. Ask first gives the agent full reach, and it asks you before it uses an
  OpenBot tool or publishes a site, and when its provider asks for approval. A new Claude agent
  shows Workspace only and Full access, because Claude does not ask for approval with full reach.
  On a joined server, an owner or admin can change the Permissions of its agents.
- Full access agents now publish, update and delete public sites and use built-in tools without
  asking, as Turbo mode did before. Before, only Turbo mode let an agent do this without asking.
- A Claude agent with Auto approve off shows Ask first. It asks before it uses an OpenBot tool or
  publishes a site, as before, but Claude's own tools run without asking. Select Full access or
  Workspace only to change it.
- "Always allow" on an approval card shows only at Ask first, and moves the agent to Full access.
- Make agent avatars do less rendering work when the pointer is outside the window. They no longer
  force a page layout on every animation frame.
- Open the app about 1 to 2 seconds faster. At start, OpenBot no longer reads and checks every
  installed provider CLI again when no file of it changed since the last check passed. A changed,
  added or removed file still gets the full check.
- Make long chats scroll and open with less work. A message that is not streaming no longer makes
  the app recalculate the page style when it comes into view.

### Removed

- The Usage page no longer shows the plan limits of each provider. The limit rings on the page rail still show them.
- Remove Turbo mode from General settings and the Auto approve switch from the model menu. Each agent
  keeps what it could do: an agent with Turbo mode on before the upgrade has Full access.

### Fixed

- Messages save faster in a large history. Before, each save read all the saved command records, so it became slower over time.
- Show no "Provider error" message when Grok cannot read its usage. Before, the message came back
  on each usage refresh. The usage still shows as unavailable.
- Keep queue updates fast when an agent has received many messages. Before, each queue change
  searched all mailbox messages once for each message of the agent, so the app became slower as the
  history grew.
- The daily billing snapshot reads only open subscriptions from Stripe. Before, it also read every
  canceled subscription, and one subscription with bad data stopped all snapshots. Now the snapshot
  counts such a subscription in `skipped_subscriptions` and leaves it out.
- A chat update finds the attachments of each changed message from an index. Before, each changed
  message read every attachment in the database, so a large mailbox sync or a long chat slowed OpenBot.
- Long chats stream replies more smoothly. Before, a closed chat search read the full chat again for each streamed part of a reply.
- Keep the browser client fast while an agent writes a reply. Before, each part of the reply made
  every message in the chat again, so long chats became slow.
- Send each sign-out and account change to connected apps once. Before, the account service could
  send the same change two times, and a slow connection service could stop the cloud server check
  for minutes.
- Read Claude session history faster at start and after a provider reconnect. Before, OpenBot wrote
  each message of the selected conversation to its history index in a separate transaction, so a
  long session took seconds to read.
- The Y axis of the daily usage chart shows each amount at its grid line. Before, the top amount was below its line and the zero amount did not show.
- A provider with no known cost shows its tokens only. Before, its row said "Unavailable of known cost".
- Start faster when agents have a long chat history. Before, each start and each provider
  reconnect imported the full provider history of all agent sessions again. Now OpenBot imports
  only new or changed turns, and does not read a replaced session again after one complete import.
- Stop the database growth from agent list writes. Before, each message and each turn end added a
  full copy of the agent list to `openbot.db`, and the old copies stayed. The first write after the
  update removes them. Model changes that one agent made to another agent stay recorded.
- The routine flow check after each turn and queue change reads only the runs it can move. Before, it
  read every routine run and flow step of the last 7 days each time, so a routine that runs often
  slowed OpenBot.
- The home page title, text and buttons no longer move down when the font loads on a slow connection.
- A reply that streams finds the earlier parts of its message from an index. Before, each update of a
  streaming reply read every earlier event of the chat, so a long chat streamed more slowly over time.
- The server menu no longer shows Usage and Schedule for each server. The page rail opens them, as the 0.42.0 notes say.
- The global search command for the routine calendar is now named Open schedule, the same as the Schedule page.
- Keep only the provider CLI version in use and one older version that works. Before, OpenBot kept
  a copy of each update for 30 days, and this could use more than 5 GB. OpenBot now removes old
  versions within a few hours while it runs, not only when it starts.
- Show provider runtimes as a separate part of the Storage bar. Before, they were part of
  "App data", which was then almost all of the storage.
- Keep the usage rings of the side rail and their usage card on screen while models load. Before,
  the rings went away and came back each time a provider finished its check, so the card blinked.
- The Schedule now loads when you change to a different server while it is open. Before, it stayed on loading until you closed it and opened it again.
- On a phone, the web app now shows Usage, Schedule and the settings pages when you open them from the rail. The settings page puts its sections above the panel.
- The side panel tabs are one tab stop. The arrow keys, Home and End select a tab, and Delete closes it. Screen readers announce them as tabs.
- When Settings or Server settings opens, the focus moves to the page heading. When Settings closes, the focus goes back to the Settings button.
- The settings search tells screen readers how many settings match.
- Show local workspace and shared HTML files as pages in the sidebar when their links open. Keep the source
  view and external open option, using the same isolated page preview as HTML attachments.
- The pstack skill now shows in the Marketplace. The 0.38.1 notes added it, but the Marketplace did not have it.
- Grok agents answer again with Grok CLI 1.0.60. Before, every new Grok session failed with
  `Invalid params: additionalDirectories is not supported`, also when an agent switched to Grok.
- The log now records a message that did not start because the provider refused the session or
  the turn.
- Gemini connects on Windows when its server takes longer than 30 s to start. After a sign-in, a
  key change, or a start that did not finish in time, OpenBot waits up to 3 minutes for the next
  start. Before, OpenBot stopped the server while it unpacked, and each try failed with "ACP
  initialization timed out." The error now says which step did not finish: the start or the model
  list. The log records when each provider process starts, first answers, and ends.
- On the website, the agent network fades out at the bottom of its section. Before, the agents
  were cut off at the bottom edge.
- Fix translations with the wrong meaning, a mixed term or a mixed form of address. Before, the
  Polish mobile app showed some Russian text.
- Show an ellipsis at the end of a long label in most badges and menu items. Before, the text stopped at the
  edge with no mark. Tab labels no longer go onto a second line.
- Keep the side panel tabs when you go back to a chat from another page. Before, the open pane showed with no tabs.
- Show what the agent works on in Computer Use screenshots and remote desktop on hosted and
  self-hosted servers and in the Docker image. Before, they showed the OpenBot window. Agents now
  get their own screen, and OpenBot moves to a hidden one.
- Use the GPU again on Linux. Before, OpenBot always rendered on the CPU on Linux, so dialogs and
  panels with a blurred background were slow on computers whose GPU works. If the GPU process
  crashes, or a start stops before it is complete, later starts use software rendering, as before,
  until an update with a new Chromium version. A server (`OPENBOT_SERVER=1` or a hosted server)
  always uses software rendering. Set `OPENBOT_DISABLE_GPU=1` to always use software rendering, or
  `OPENBOT_DISABLE_GPU=0` to try the GPU again.
- An agent now sees why a browser file upload failed, for example a selector that matches two file
  inputs or a file that does not exist, and can try again with a better target. Before, a Codex
  agent saw only "dynamic tool request failed", and OpenBot showed a "Provider error" message.
- When the server reads its member list, it now disconnects a member that was removed or got
  another role. Before, the open session could continue with the old role until it ended.
- Update the Claude plan limits while an agent works. Before, the limits changed only on the next
  refresh.
- Read the Claude plan limits faster when the computer has a large Claude history. Before, the
  read could time out.
- Keep a record when an agent delete fails. Before, a host on Windows kept no record of the step that
  failed. Now `logs/agents/agents.log` shows the step and its error code, with no file paths.
- Muse turns no longer fail when the workspace appears more than once in the writable roots.
- Keep MCP servers such as Vercel signed in after their access token expires. Before, OpenBot did not
  ask for a refresh token, so the server refused agents one hour after each sign-in.
- Show "Sign-in needed" for an MCP server whose access token expired and cannot be refreshed. Before,
  the row also showed "Signed in".
- **Sign in to Vercel and other OAuth MCP servers again after you upgrade.**
- In the desktop app, the name of a rail button now moves to the next button when the pointer moves down the rail. Before, the name closed between two buttons and opened again.
- Keep a routine open in agent settings while the agent works. Before, each new turn or status
  update of the agent closed the routine and went back to the agent settings, and the edit in
  progress was lost. Memories, Skills, Tables and Files in agent settings also stay open now.
- Fix spreadsheet previews for January and February 1900. Keep Excel's February 29, 1900 compatibility date and the correct time in date-and-time cells.
- An OpenCode agent no longer fails each message and routine run with "The request contains invalid parameters" after a model change or in a long chat. OpenBot now starts a new OpenCode session with the chat history and sends the message again.
- A Muse agent no longer fails each message with "MCP startup audit failed; MCP is disabled for this runtime" after an MCP server, such as Computer Use, did not start once. OpenBot now starts a new Muse session with the chat history and sends the message again.
- GIF and AVIF attachments keep their image format when sent through ACP, Muse and Pi.
- Keep quoted currency and text prefixes in spreadsheet number previews.
- The Antigravity model picker shows each Gemini model one time, with its efforts in the Effort menu. The model and effort that you select now apply to the session. An agent saved on a Gemini model with an effort in its name keeps that model and effort.
- A message that you send while Codex compacts the context now waits in the queue and runs after the compaction. Before, Codex refused it and the message failed. When a compaction takes too long, OpenBot now asks Codex to stop it before the queue continues. Thanks to @Johnny-xuan for the report and the first fix (#1766).

### Security

- Open an attachment with its default app only when it is an image, audio, video, document or
  plain text file. Other files, such as scripts, web pages, programs and old Office files that can hold
  macros, show in the file manager.
  Before, Open on a file from a remote server or from a team member could run it.
- Remove characters that are not permitted in a file name from the name of a file that a remote
  server sends, before OpenBot keeps a copy to open it.
- Limit the downloads of a page in the browser to 4 at one time and to 2 GB each. Before, a page
  could download files until the disk was full.
- Make the remote connection service safer. It now closes a connection that does not sign in within
  30 seconds, and it gives the same relay credentials again when a device asks for new ones too
  frequently. Before, an idle connection stayed open for up to one day, and each request made new
  credentials.
- Stop the relay server from sending data to more reserved network ranges, such as NAT64 and
  benchmark ranges.
- Remove more types of secrets from logs, diagnostics and exports: JSON Web Tokens, private keys,
  every cookie in a cookie header, credential values in web addresses, and Google, GitLab, npm,
  Hugging Face, Groq, AWS session and Stripe keys. Before, a secret of these types from a provider
  message could stay in a log.
- Disable and remove members correctly when an admin uses a team app on a server with an OpenBot
  account. Before, the change was only in the team file of the server: the account kept the
  membership, and the member stayed connected. Now the account changes, and the server closes each
  session of that member. This also applies to a change from the desktop app.
- Count failed sign-in attempts for each connected device. Before, all devices that connect through
  the account service used one count, so one member could stop password sign-in to a user name for
  all other members.
- Count sign-in attempts for a user name with spaces around it as attempts for that user name.
- Send a server invitation email only for an open invitation that an owner or admin of that server
  made for that address. Before, any signed-in account could send an OpenBot invitation email to
  any address.
- Show "OpenBot user" in the skill and agent marketplaces for a creator with no display name, and
  do not search creators by email. Before, the marketplaces showed the email address of such a
  creator.

## [0.42.0] - 2026-10-16

### Added

- The website has a new section, "Your agents talk to each other". In an animation, Ada, Linus and
  Grace pass a task through OpenBot. Then a network that is different at each visit grows until it
  fills the screen. With reduced motion, the section shows the complete network.
- A Help button in the page rail opens a menu with the newest release notes, the full changelog, the guides and Send feedback.

### Changed

- The license names Synthetify Labs spółka z ograniczoną odpowiedzialnością as the licensor. For a
  commercial license, write to licenses@openbot.run. The macOS and Windows app copyright
  also names Synthetify Labs.
- The desktop window has a page rail at the left and a darker frame. The sidebar, the chat and the side panel sit in one card. The rail opens Agents, Routines, Schedule, Usage, Marketplace and Settings, and it shows the plan limits of each provider as rings.
- Settings is now a page of the window, not a dialog, with a search for settings. Server settings is a separate page: open it from the server menu. When you select a different server, the server settings page shows that server.
- The server menu in the top row is now the default way to switch servers. If you chose the server rail before, it stays. To use the rail, open the server menu and select Server layout.
- The chat header has one panel button. It opens the side panel, which shows Browser, Files, Tasks and Agent settings as tabs. Use + to add a tab that is not open, and Maximize to give the panel the full width. When the tab labels do not fit, the tabs that are not selected show only their icon. A pane does not repeat the title and close button of its tab, and its content fades at the scroll edges. The Tasks tab shows closed tasks below the open ones, grouped by day, so you can open and reopen them.
- The account box at the bottom of the sidebar is removed. Sign out is now in Settings > Profile, and Billing stays in Settings. When an update is available, the update notice shows at the bottom of the sidebar in the colors of the old account box.
- The server menu no longer lists Marketplace, Usage and Routines, because the page rail opens them.
- The web app has the same page rail as the desktop app. The switch over the chat list and the account box are removed. Settings on the web holds Billing and Sign out.
- The routine calendar is now named Schedule, the same as its rail button. The Routines button of the rail shows the routines list in the sidebar.

### Fixed

- Keep message sends and queue status changes fast when the chat history is long. Before, each
  change wrote all mailbox messages again, so the app became slower as the history grew.

## [0.41.0] - 2026-10-16

### Added

- Add a contact form at `openbot.run/contact`. The Contact buttons on the website open it, and the
  message goes to the OpenBot team by email.
- A new customer now gets a "Welcome to OpenBot!" email when the plan of their first cloud server
  starts. The email shows the plan, the server name, and a link to the web app.
- An agent can work on tasks at the same time as its chat. Start a task with "New task" in the chat menu, or move a queued message to a task with "Run as task". The agent can also start a task itself.
- Each task has its own conversation, progress, stop button and result. Open a task from its chip below the chat, or from the chat menu. Closed tasks stay under "Earlier tasks", where you can open them again.
- Two tasks of an agent run at the same time. Change this from 1 to 4 in the agent's settings, under Advanced, "Tasks at once". Other tasks wait, and the task shows why it waits.
- A custom ACP agent runs one turn at a time: its tasks and its chat wait for each other, and the settings show this.
- When a task fails, its panel shows the error, also after a restart. The main chat does not.
- Tasks run without Computer Use, so that only the agent's chat controls the screen. Each task has its own browser tabs.
- You cannot change an agent's provider while its tasks run. After the change, the tasks continue on the new provider.
- The transfer file keeps the "Tasks at once" setting of each agent.
- Add an "OpenBot for Teams" section to the website. It shows managed servers, team environments,
  custom integrations and launch support, and its Contact us button opens the contact form.
- Add a For Teams page to the website, at `/teams`. It shows the three setups (local, managed server
  and custom deployment), what a server adds, the steps of a custom deployment, and who it is for. The header
  and the Teams section on the home page open it, and its buttons open the contact form.

### Changed

- A full refund of the current payment for a cloud server now ends its plan at once. The server
  stops and keeps its data. Before, the plan continued and renewed.
- The chat header has one menu for the computer, remote control, files, agent settings and tasks.
- The log records when a provider starts and stops connecting, so a report of a provider that stays on "Connecting" can show the cause.

### Fixed

- Show why a Telegram connect failed on a joined server. Before, the error said only "Request
  failed.".
- Stop the Telegram connect dialog from waiting for Telegram after a connect fails.
- A hosted server could start with "OpenBot database failed its integrity check." after it stopped.
  The host saved the disk while OpenBot wrote its database, and kept a damaged copy. A hosted server
  now stops OpenBot and closes the database before the host saves the disk. A server gets this
  change when it updates and starts again.
- A server that got the stop signal (for example, from `systemctl stop` or `docker stop`) ended at
  once. It now stops its services and closes the database, as the desktop app does when it quits.
- The integrity check error is now in your language, and the log shows which parts of the database
  are damaged.
- Muse shows "Connected" after you sign in with your Meta account or save a Meta API key. Before, Muse always showed "Muse authentication is not verified", also after a successful sign-in. When Muse has no credential, it now asks you to sign in.
- Open an agent with very long messages from a remote device. Before, the connection to the server
  dropped and reconnected again and again. The server now sends fewer messages at a time, and you
  load the rest when you scroll up.
- Show an error when a server reply is too large to send to a remote device. Before, the server
  closed the connection.
- Keep the numbers in a Markdown list in order when you add an item between existing items in the
  message box. Before, the new item and the item below it had the same number.
- A server signs in to OpenBot at start when a slow database check holds the start. Before, the
  sign-in failed and the server went online about one minute later.
- Start OpenBot faster after a clean stop when the database is large. Before, each start read the
  full database file to check it, which took minutes on a large file. The check now runs only after
  a stop that did not close the database, or after a database upgrade.
- Stop the database from growing each time a conversation is read. Before, each read wrote the
  latest messages again when nothing had changed, so `openbot.db` could grow by gigabytes. An
  upgrade deletes the repeated writes that follow each other in a chat, which are most of them,
  and makes the file smaller. On a large database, the first start after the upgrade takes longer.
- A hosted server no longer stops soon after it starts while you read it in a focused window or tab. Before, it stopped about 15 minutes after a wake when you did not type or click, and showed as asleep. An app that has focus now keeps it on for at most 30 minutes after your last message, change or typing, or after you return to the app.
- The desktop app and the web client wait while a hosted server starts. Before, they
  stopped waiting after 5 minutes and showed "did not start in time", also when the server came online
  a minute later. They now stop only when the machine runs and OpenBot on it does not connect in 15
  minutes.
- The desktop app and the web client show the start step and its time while a hosted server starts.
  Restart is not available while the machine starts.
- The desktop app shows when a hosted server did not start, could not start, or has an ended plan.
- When the cloud provider limits new starts, the account server tries the start again after a delay,
  and the desktop app and the web client say so. Before, they showed "Could not start".
- A conversation and its unread count load from an index of the message order. Before, each load sorted
  the whole chat several times, so a client that opened many agents could stall OpenBot for seconds.

## [0.40.0] - 2026-10-15

### Added

- Backup models for a usage limit. When the plan of an agent's model refuses a turn, the chat shows a card: send the queued message to another connected model now, or wait for the reset. By default the agent asks first. Agent settings › Backup models keeps an order; turn off "Ask before switching" and the agent moves to the first ready model in the order without a question. A note in the chat shows each switch, and the agent goes back to its own model when the limit ends. The agent keeps its workspace and thread.
- Set a server timezone in Server settings → General. Agents use it for a new routine when the message does not give the sender's timezone. Before, a message that waited across a server restart created its routine in the timezone of the server's computer, often UTC.
- Connect 1Password on a joined server, such as a server with no screen. In Settings › Connectors, an owner or admin of the server pastes a 1Password service account token. The server checks the token, keeps it in its own encrypted store, and keeps the connection after a restart. The page shows the vault names and the login count of that server. Disconnect acts on that server only. Both sides need this release; on an older server, 1Password does not show.
- An agent routine on this computer can send each answer to a Slack, Discord or Telegram place. Choose the place in "Send answers to" in the routine editor.
- The run history shows where each answer went. A delivery has its own status: a run that succeeded stays succeeded when its answer is not sent. A connection that does not run gets more attempts for one day. Use "Send again" for an answer that was not sent, or that OpenBot stopped during the send.
- Agents can set what a routine does with runs that came due while OpenBot was off, and what it does at the account usage limit. An update that changes one of these settings keeps the other.
- On a joined server, an owner or admin can see and change what a routine does with missed runs, and see the missed runs in the run history. The server must have this version of OpenBot.
- Routines can run one time, at a local date and time. After the run, the routine stays as a paused record. You can cancel it before it runs. A run missed while OpenBot was closed runs one time at start, unless you set it to skip. A restart does not run it again. Agents use this schedule for reminders, not a yearly schedule. Only the desktop app on the computer that runs OpenBot shows one-time routines for now.
- Several instances on one Docker host: `openbot-instance backup`, `verify`, `restore` and `backups` back up all data of an instance, check the backup in a temporary folder, and restore it with the same agents and conversations. To back up an instance each day, turn on its timer with `systemctl enable --now openbot-instance-backup@<name>.timer`.
- Settings → Dynamic Island has a Servers list. Turn off a server to hide its agent activity and requests from the island. The server stays connected and its desktop notifications continue. A switch sets whether servers that you add later show in the island.
- Add links to the OpenBot Discord community on openbot.run: a "Discord" item in the Resources
  column of the footer, and a Discord icon next to the GitHub and X icons.
- Add discord.openbot.run, a short address that opens the OpenBot Discord community.
- Agents fill forms in the built-in browser faster. They can fill up to 16 text fields in one step. They do not use this step for password, verification code, or card fields.
- Send agent notifications to the OpenBot app on Android phones. The phone gets the same events as
  an iPhone: a finished task, an error, a question, an approval, or a step in the browser. The
  agent name and the text are sealed, so Google and the OpenBot account service cannot read them.
- The website compares OpenBot with Instinct at /compare/instinct: where agents work, who holds your data, who approves actions, price, and where you can use each.

### Changed

- A self-hosted server and the Docker container use the memory guards of a hosted server. When free
  memory is low, new turns wait in the queue and the browser opens no new tab. A fixed number of
  turns run at the same time, from the memory limit of the service or the container. Before, these
  servers started every turn and could run out of memory.
- `openbot status` on a self-hosted server or a container shows the memory limit, the free memory
  and the turn limit.
- Admins of a hosted server can now restart it from the server menu. Before, only the owner could restart it.
- The model picker in a conversation shows only the providers that are ready to use. Select + to connect another provider in Settings.
- A disputed payment for a hosted server ends its plan at once. The server stops and keeps its disk. A refund keeps the plan and the server running.
- After you delete an agent, a notice with an Undo button shows for 8 seconds. Press Undo to get the agent back in the same place. OpenBot deletes the agent only when the time ends. The time stops while the pointer is on the notice.
- The "Contact" button in the openbot.run header is now "Community". It opens the OpenBot Discord
  community instead of the OpenBot account on X.
- Docker and hosted servers now include bubblewrap. Codex recommends the system copy instead of its bundled copy.
- Docker documentation explains browser access and how to check a new release before upgrading a self-hosted server. It includes the release metadata source, deployment-file review and cold backup steps.
- The add server dialog now asks "Need more power or a custom solution?" in its footer, in all languages.
- "Contact us" in the add server dialog opens an email with a subject and a short message to complete.
- A phone gets no notification while you use the desktop app, also for a question, an approval, or a
  step in the browser. The desktop app shows these itself.

### Fixed

- An agent that sent many messages to teammates made each chat open and each finished turn slower, because OpenBot searched all saved message keys again for each message. It now reads them once.
- File, agent, skill and MCP chips in a message are centred on their line again. Before, their icons sat low, the file type badge went out of its box, the agent face was clipped on the right, and a file chip could cut a short name such as `provider-session.log` with an ellipsis.
- Skill and MCP chips in a message and in the message box have icons of the same size and line weight as file chips. Before, their icons were larger and heavier.
- Telegram messages and captions now preserve repeated spaces and tabs. Previously, code indentation and tab-separated text lost their spacing.
- Show Markdown block quotes as quotes in Slack, including quotes with up to three leading spaces. Before, the message showed the `>` mark as text and no quote.
- Telegram animations are now imported once. Previously, the same file could appear twice as an attachment.
- Show email link labels and addresses as readable text in Slack messages and conversation history. Before, these links showed raw Slack markup.
- Show Slack group mention labels in incoming messages and history. Before, these mentions showed raw Slack markup.
- Keep underscores inside words with Unicode letters, numbers, or combining marks in Telegram messages. These underscores no longer turn parts of the word into italic text.
- Emoji and other supplementary Unicode characters stay correct when a long Slack or Discord message splits into posts. Before, a split could break such a character.
- Discord author and channel names can recover after a failed lookup. Before, later lookups kept showing the ID.
- Slack author and channel names now recover after a temporary lookup failure. Before, the names stayed as IDs until the connection restarted.
- Gemini no longer fills the disk on Windows. Each start of the Gemini server unpacks about 310 MB
  into the temporary folder, and a start that was stopped or timed out left that copy behind. Now
  each Gemini process on Windows uses its own folder in the OpenBot data folder, and OpenBot removes
  it when the process ends and at each launch.
- On Windows, Gemini does not start when the disk has less than 1 GB free, and says so.
- After 3 failed starts in a row, OpenBot stops starting a provider by itself and shows why on the
  provider row. Refresh the providers to try again.
- On Windows, to get back the disk space that Gemini used in earlier versions, quit OpenBot and delete the `_MEI` folders in `%TEMP%`.
- On Linux, the invitation page now offers the Linux installer. Before, Download OpenBot gave the macOS installer.
- A self-hosted server now starts again when `sudo openbot update` fails or is stopped. Before, the
  server stayed stopped until an operator started it.
- A browser live view that moves to a new connection now stops the previous view. Before, the previous view kept the screencast and the page size active.
- Many large chats no longer stop the app for a second or more when their history gets too large to keep in memory. Before, OpenBot measured all chats again for each old message that it removed.
- A published site now sends a folder address without a final `/`, such as `/guide`, to `/guide/`. Before, the page opened at `/guide`, and its relative styles, images, scripts and links did not load.
- Slack, Discord, Telegram and webhook connectors no longer stay at Connecting when Signal accepts the connection but does not answer. After 15 seconds, OpenBot closes that connection and tries again.
- After a Codex protocol error, OpenBot now stops the old Codex process with SIGKILL when it does not stop within 2 seconds. Before, the old process could continue to run next to its replacement.
- In a narrow settings column, the ACP registry actions move under the agent and wrap. Before, long translated labels hid the agent name, covered its version, and cut off Remove runtime.
- Stopping Pi or Muse while a chat opens now also stops that chat's provider process. Before, the process could stay open after the provider stopped.
- Record the correct owner when two agents create shared tables at the same time. Before, both
  tables could go to the first agent, and the other agent could not remove its own table. A table
  that the user makes outside OpenBot also stays without an owner now.
- A transfer to another computer keeps executable workspace and shared files executable. Before, an imported script failed to run by its path.
- ACP registry settings now keep a gap between the search and agent ID fields and their buttons, and between Install and Cancel. Before, these controls touched.
- A transfer export stops with an error when it cannot read a workspace, skill or shared folder. Before, it left out the folder's files and reported a complete export.
- Agents can now write, search, and delete full-text (FTS5) and R*Tree tables in the shared database. Before, SQLite refused every use of these tables after `CREATE`, refused to create an R*Tree table, and the table could not be removed. While such a table existed, the shared tables list also showed no row counts.
- An agent can read the result page after it submits a form in the browser. Before, the click failed and the tab showed an empty page.
- An agent that answers in Slack, Discord or Telegram no longer stops answering after a provider error. Before, a failed Muse turn start, a provider that exited, a turn that ended before its start was confirmed, or a turn start with no confirmation could hold every later message with "OpenBot is working on another request" until OpenBot restarted.
- An agent in a Slack, Discord or Telegram conversation no longer waits for an answer to a question card that nobody there can see. It asks the question in its answer instead.
- An approval request that did not reach Slack, Discord or Telegram is posted again when the conversation is connected. Before, the turn waited with no notice in the conversation.
- The "Working" and "Waiting" posts in Slack, Discord and Telegram now end after a restart, a provider crash or a lost connection. Before, they stayed with a Stop button that did nothing. When an answer cannot be posted, the conversation now says that OpenBot could not finish the request.
- Slack and Discord messages no longer wait minutes to start when a channel or user name lookup is slow.
- A hosted server that wakes now handles the kept Slack, Discord and Telegram events of each workspace or chat separately. Before, one connection that could not start held back the events of all other connections, and each of its events waited 60 seconds.
- A Telegram chat that you link while OpenBot connects to Signal again now shows in OpenBot. Before, the link could be lost, and you had to link the chat again.
- An agent that answers in Discord, Slack or Telegram no longer stops answering after a restart. Before, a restart could make one of its conversations the agent's own chat. Then, after a routine ran there, every new message waited with "OpenBot is working on another request" until OpenBot restarted. A restart no longer does this. An agent that is already in this state keeps its chat and its history, and answers again.
- The chat of such an agent shows its new messages in the app again.
- Stop the Windows download page and the OpenBot 101 guide from saying that the installer is not
  code-signed. They now say that SYNTHETIFY LABS signs it, and tell you how to continue when
  SmartScreen still warns about a new release.
- You can name a sidebar section with a Japanese, Chinese or Korean input method. Before, the Enter that confirms a conversion saved the section, and Escape closed the editor and lost the name.
- Start custom agents that need Node or another tool from your shell when you open OpenBot from
  Finder, the Dock, or a login item. Before, they stopped with exit code 127. Check agent now uses
  the same `PATH`, and a `PATH` that you saved on the agent still wins.
- The Model field in agent settings, first-agent setup and the Slack and Telegram agent forms uses the full width of its row in narrow windows. Before, in windows 720 pixels wide or less, the field stayed at 148 pixels and cut the model name.
- A provider CLI that cannot update or set up now shows "Update failed" or "Setup failed". Before, each failure showed "Download failed", also when the download was complete and the new CLI did not start.
- The provider log (`logs/providers/providers.log`) now records the provider, the version and the step where a CLI update failed (`download`, `verify`, `install` or `activate`). Before, the line did not name the step or the version, and it could hold your home folder path.
- Connect for Muse opens the Meta sign-in page. Before, no page opened and the sign-in could not finish.
- A failed provider CLI update no longer shows the system error and your home folder path in the provider row, the model picker, or the provider status that team admins read. The row now shows a short reason, such as "Try again.". The full cause stays in `logs/providers/providers.log`.
- A failed provider CLI update now says "The update failed. Try again." Before, it said that the update was interrupted, also when nothing interrupted it.
- Keep the account of an idle provider when its CLI update fails. Before, the provider showed that
  it needed a new sign-in, but the old CLI was still installed and signed in.
- Do not show a "Provider error" when Codex uses its bundled bubblewrap. Before, Codex showed this error on each connect on Linux servers, but it worked.
- Keep the Create agent button visible and clickable when the agent description is long or the window is small. Before, the suggestion cards covered the button.
- A scheduled routine no longer starts after you pause, delete or reschedule it while another routine is starting. Before, OpenBot could still start the old occurrence. A routine that you edit at that time now uses your new instruction and settings.
- Docker instance restore now verifies the backup before it stops the target or replaces its data.
  A backup with valid checksums but a damaged database could previously replace healthy data.
- Auto approve and Turbo now accept Codex's request to run an MCP tool. Before, a new tool still asked each time. A Workspace only agent, a Computer Use tool, a tool set to ask every time, forms and sign-in requests still ask.

## [0.39.1] - 2026-10-14

### Added

- Add Vercel to the Apps catalog. Agents can list projects and deployments, read build and runtime
  logs, and find why a build failed after you sign in to your Vercel account.
- Agents can capture the screen of the computer that runs them: one display, one window, or an area of a display. You approve each capture first, or Turbo approves it when it has a standing approval for the agent, and the image shows in the conversation. Computer Use in the agent settings turns screen capture on or off for each agent. On macOS, OpenBot asks for the Screen Recording permission and tells you how to turn it on.
- Codex, Claude and Grok can have more than one account. In Settings › Providers, select Add account under a provider to sign in to one more account. Each account keeps its own sign-in and its own usage limits, and you can rename or remove an account there.
- Each agent can use a different account of its provider. Select the account in the model picker. The agent keeps its account after a restart.
- The Usage menu shows the limits of each account.
- An owner or admin of a server can add, rename and remove the provider accounts of the server, and select the account of each agent, in the desktop app and in the web client. The sign-in page of a new account opens in the server's browser.
- An instance of `docker/instances` now updates from the app, like a hosted server: Server settings › Updates and the update dialog pull the new image on the host and make the container again, with the same data. The container never gets the Docker socket: it writes an empty request file, and `openbot-instance-update@<name>.path` on the host runs the update as root. It installs only a newer version. See "Updates from the app" in `docs/docker.md`.
- **For an instance made before, run `openbot-instance setup`, then `openbot-instance upgrade <name>` once.**

### Changed

- The actions of a message are now in one row under the message, with the time: Copy, React and Reply. Before, they were at the side of the message, and Copy was in a `…` menu that had only Copy.
- Agents that answer in Slack, Discord and Telegram answer simple questions themselves. They ask a
  teammate only when the request needs the tools, accounts, files or memory of that teammate, or
  long work.

## [0.39.0] - 2026-10-14

### Added

- The server connection notice has a Details button. It shows why the server is away (an update, a start, or a lost connection), each step until the workspace is back, and how long it has taken.
- Slack, Discord and Telegram now show in Marketplace › Apps, next to GitHub, 1Password and Bitwarden.
- Run several OpenBot Docker containers on one host, each with its own CPU, memory and disk limit, with `docker/instances/openbot-instance`. The containers cannot reach each other, the host or private networks, only the internet. See "Several instances on one host" in `docs/docker.md`.
- Server settings > Transfer moves the agents of a server to another server, also between computers. Export one file from the old server and import it into the new one. The file holds the instructions, avatar, model, skills, routines and memories of each agent and, if you want, its workspace files, plus the MCP servers, custom model providers and sidebar sections of the server. It also works with a joined server when you are its owner or an admin, for files up to 100 MB. API keys, sign-ins and chat history are not in the file. After the import, OpenBot shows which providers to sign in to again.
- An operator can sign a self-hosted server or Docker container in for somebody else with no email code: `openbot login --claim`, which reads the claim from standard input. The account service makes the one-time claim for the owner's email with the new `SERVER_CLAIMS_ADMIN_TOKEN`. The claim works once, for 15 minutes. See "Sign in with a server claim" in `docs/self-hosted-server.md`.

### Changed

- The "MCP" link in the Server settings header no longer shows a background on hover. Only the text gets brighter.
- The openbot.run home page now shows the iPhone and Android apps next to macOS, Windows and Linux. The "Available on" line and the footer list them, and the download menu has a "Phone apps" group with links to TestFlight and Google Play.
- On an iPhone or an Android phone, the main download button of the home page now opens the phone app's store page. Before, it offered the Mac or Linux installer, which a phone cannot open.
- When you restart a hosted server, the dialog stays open and shows the restart: the server stops, starts, and is back online. You can hide the dialog; a notification then tells you when the server is back or did not start. If the server does not start, "Try again" restarts it from the dialog.
- Connect on a provider row now uses the easiest sign-in for the place you are in. On this computer, it opens your browser. On a server, from the app, it opens the sign-in page in your browser and sends the result to the server. In a browser tab, it shows a code. The other way to sign in is in the row's ⋯ menu.
- In a browser tab, a provider that only the OpenBot app can sign in now tells you to connect it in the app, with a link to get the app.
- In a browser tab, Gemini's ⋯ menu now has "Paste the address", so you can connect it without the app.
- The Mobile tab of the changelog page shows the stores that have each version of the mobile app:
  iOS, Android, or both. A store that does not have the version yet shows "In review". When the two
  stores released the version on different days, each store shows its own date.
- On the routine canvas, each connection now ends in an arrow where it goes into the next card, so you can see the order in which a run goes from one agent to the next. The step number in the corner of each agent card is removed; the routine details panel still shows it.
- On a joined server, 1Password and Bitwarden now show in Server settings › Connectors as "Your computer only". Before, they did not show.
- When a joined server has a new OpenBot version, a dialog now shows the update steps: download, restart, and back online. One click starts the update. An admin can let the restart wait until agents are idle, restart at once, or cancel the restart. You can hide the dialog while the server updates; a notice keeps the status and opens the dialog again.
- In Server settings > Updates, "Update when idle" and "Restart now" open the same dialog.
- The update dialog opens each time you enter a server that has a new version. An update button next to the server name in the sidebar opens it again.
- The openbot.run website now keeps the first visit of your browser (source, first page, day and campaign tags) in the browser. When you sign in on the web, or open the page after a desktop checkout, OpenBot saves it on your account for product analytics. It contains no referrer, IP address or identifier. [PRIVACY.md](https://github.com/nightly-labs/openbot/blob/main/PRIVACY.md) describes it.

### Fixed

- In an MCP form, the `›` in the Server settings header had more space on its left than on its right. Now the space is the same on both sides.
- When your ChatGPT sign-in expired, creating an agent showed "workspace routing discovery unauthorized (401)". Now OpenBot tells you to sign in again, and the model picker shows the sign-in action.
- When an OpenCode model ends a turn with no answer, the chat now says so, and says when the model stopped after its reasoning. Before, it told you to check sign-in and billing, also for free models where neither is the cause.
- When you select a server on another computer, OpenBot now connects to it at once. Before, if the connection to that computer stopped recently, the server could show "Connecting" for up to 5 minutes.
- Keep a phone or another computer connected when it is slow to read updates, such as a phone in
  the background while an agent works. Before, it could disconnect with "The host event stream has
  a gap.", because this computer sent updates out of order or skipped one that it could not send.
- The open waits of an agent, and their errors, now show in German, Spanish, French, Italian, Japanese, Polish, Brazilian Portuguese, Russian and Turkish. Before, they showed in English.
- Some routine flow messages in French, Japanese, Polish, Brazilian Portuguese and Turkish, and some provider sign-in text in Italian, now show in the selected language. Before, they showed in English.
- On a server, "Log in with code" in the ⋯ menu opened the sign-in page again. Now it shows a code.
- On a server, the model picker's Connect and Claude's Sign in button did nothing. Now they start the sign-in.
- On a server that you manage, the message box now shows the sign-in notice for a signed-out provider.
- The app now connects again after a server on another computer restarts. Before, it could show "The remote request timed out" until you restarted the app. Retry now also replaces a connection that does not answer.
- While a server on another computer is offline, a conversation shows one "Queue load failed" error, not a new one for each agent change. The same error again replaces the earlier one.
- While a server on another computer restarts to install an update, the desktop app now shows "Updating" and the server name, not a connection error. The app now waits up to 30 minutes, not 10, before it treats that server as offline.
- A server that goes offline while its update waits no longer shows "restarting to install an update". The app shows that text only when the server starts the update restart.
- The chat card that suggests a connector now works for every connector, on a joined server and in the browser client. Before, it worked only for GitHub, and on a joined server it said that GitHub works only on this computer.
- A GitHub sign-in that waits for the code now shows "Connecting". Before, it showed as not connected.
- In Marketplace › Apps, Connect on the GitHub card now shows on a joined server that can run connectors. Before, it showed only when the server could manage MCP servers.
- The Bitwarden card in Marketplace › Apps now shows the same lock mark as Server settings › Connectors.
- On a joined server, the Routines view no longer says that the server does not support routine flows while OpenBot connects, reconnects or waits for the server to wake. The view stays empty until the server answers, as it does while routines load.

## [0.38.2] - 2026-10-13

### Added

- Italian interface. Choose Italiano in Settings > General > Language, or keep System default on a
  computer that uses Italian. The web client uses it too.
- A server sends iPhone notifications to its members when an agent finishes, stops with an error, or
  needs input, an approval or a step in the browser. It sends no answer or error to a member who
  uses a desktop app at that time. While the phone shows the Live Activity, the Live Activity shows
  the event in place of a notification, and lights up the screen and plays the sound when the phone
  chose that. It uses the choices of each phone, and seals the agent name and the text
  so that Apple and the OpenBot account service cannot read them. The server keeps the phones that
  get notifications, so they continue after a restart.
- You can cancel a Gemini (or other browser) sign-in that waits for the browser. Before, the only way out was Restart, which opened another sign-in page.
- While a provider connects, its row tells you to finish the sign-in in your browser.
- Agents can now post to a connected Slack, Discord or Telegram place on their own initiative, from
  any chat or routine run. Ask an agent to "post the summary to #bot-inflow", or put it in a routine
  prompt. `openbot.messaging_list_places` lists the connections and their channels, and
  `openbot.messaging_post` posts the text, redacted. Before, an agent could only answer the
  conversation that addressed it.

### Changed

- When a queued message waits and no turn runs, the server log now names what holds the queue, so a
  queue that does not start can be diagnosed.
- The sign-in code email leaves about one second sooner. Before, OpenBot waited for 10 replies from the mail server, one after another, before it showed the code field. Now it waits for 5.
- Agents show a draft before they send a message for you, and they send it only after you approve it. A routine whose instruction asks for a send still sends. Before a payment, an agent reads back the item, price and total and asks you to confirm.
- Agents give the answer first and do not invent facts or sources. An agent says done only after it checks the result.
- When you say stop, an agent also stops each teammate that it gave work to, and tells you which teammates stopped.
- Agents look for a teammate earlier, when a task or part of it fits another agent's title and description. Before, they looked mostly after a failure. This helps when you have many agents.
- A message from one agent to another now contains all that the other agent needs, without your other private details. When the answer comes back, the agent checks it and tells you which facts have a source.
- For a repeated or timed request, such as "every morning", an agent creates a routine or offers one.
- Server settings > Connectors shows the open connector in the header, for example "Connectors › GitHub". Select "Connectors" to go back to the list. The "All connectors" button is removed.

### Fixed

- Open OpenBot from an invitation link on Windows. Before, Open OpenBot on the invitation page did
  nothing, because Windows had no handler for `openbot://` links.
- Show help on the invitation page after Open OpenBot is pressed, in case OpenBot does not open.
- Agents now show in their sections when a server starts or reconnects. Before, the sidebar sometimes showed them ungrouped until you refreshed the app.
- Opening or writing to a chat no longer shows "Read state failed" when the read mark names a message
  that is not saved yet or was removed, such as a queued message on a hosted server. Before, every
  open and every send showed the error again.
- The Google sign-in for Gemini no longer stops when you return to OpenBot before you finish it in the browser on the first-run screen.
- A failed Gemini sign-in now shows the reason, such as a timeout or Google's own message. Before, every failure showed "OpenBot could not connect Gemini. Try again."
- When Google refuses a saved Gemini API key, OpenBot says so. Before, it asked you to sign in with Google, which could not help while the key was saved.
- OpenBot no longer opens a Google sign-in page by itself when it checks Gemini with an expired sign-in. It shows "Sign in with Google to use Gemini." at once, without a long wait.
- A Gemini chat whose session was lost now starts a new session. Before, every next message in that chat failed.
- When the Gemini plan's quota is reached, the turn fails with a clear message. Before, the quota notice was saved as Gemini's answer.
- Gemini no longer asks for approval of a tool after you press Stop.
- Gemini no longer shows a "Provider error" notification for each line of its internal log, such as after a Stop or a failed request. The failed turn says what happened.
- When Gemini fails a request, for example because the API key is not valid, the turn fails with a clear message. Before, the error was saved as Gemini's answer.
- The Gemini row in Settings always has an API key button, so a saved key can be replaced or removed while Gemini shows Connected.
- After you cancel a sign-in, the provider row shows again why it is not connected.
- Provider rows in Settings show why a provider is not ready, or why its download failed, as text. Before, the reason was only in a tooltip.
- A Connect that fails in Settings, the model picker or the chat composer now shows why.
- The Gemini row and other downloaded providers show "Update available" in Settings, as the update notification does.
- On the first-run screen, the main button downloads the selected provider when it is not downloaded, and says Download.
- The Server settings header no longer moves by 1 pixel when you open or close an MCP form.

## [0.38.1] - 2026-10-13

### Added

- A mention, a direct message, a thread reply or a button press in Slack, Discord or Telegram starts
  a hosted server that sleeps. Signal keeps that message, encrypted for the server, for up to
  10 minutes, and the server answers it when it starts.
- Dictation can use ElevenLabs Scribe v2 Realtime with your own API key. Select it in **Settings → Voice** and save the key. The text shows while you speak, and a finished sentence stays fixed. The audio goes to ElevenLabs only when you select this model.
- The Routines canvas is now in the web app and on joined servers. Switch the sidebar to Routines to see an agent's routines, connect agents, edit their tasks, run a routine and ask the agent to edit the canvas. A member who can see an agent can change its canvas; only an owner or admin sees and changes webhook settings. The server must run this version of OpenBot.
- Visual replies and HTML files show as pages in the web app, as on desktop. The page runs in a sandboxed frame and cannot read the web app.
- Image attachments show as thumbnails in the web app, and audio and video attachments of 10 MB or less play in the chat after you select Play.
- The iPhone app can search the files in the chats of this computer.
- An agent can stop a request and wait for an event outside its turn, such as a build or a nightly run. The chat shows each open wait above the composer. The next routine run of the agent, or a local script that names the wait, continues the request with the original message and the agent's note. Use the ⋯ menu of a wait to show its request or cancel it.
- Generate a permanent Mobile Connect link in Settings > Mobile Connect. You can show it again, copy
  it, replace it or revoke it. The link signs in a phone each time you use it, until you revoke it
  or sign out on this computer. Revoking the link also disconnects the phones that signed in with
  it.
- Copy or cancel a one-time Mobile Connect code. A cancelled code cannot sign in a phone.
- See in Connected devices whether each phone signed in with a one-time code or a permanent link.
- Agents that answer in Slack, Discord or Telegram can save short facts about the workspace, such as who owns a project. Every new conversation in that Slack workspace, Discord server or Telegram chat sees them, in every channel. The agent's own chat does not. A fact from a direct message is not saved.
- An agent that answers in Slack, Discord or Telegram can read more of the channel or thread when a message refers to something earlier.
- The owner of a hosted server can restart it from the server menu, on desktop and on the web.
  Restart server is above Leave server and Delete server. The server stops and starts again, and
  the app connects again when the server is back.
- Add the pstack skill to the Marketplace. Install it on the agents you choose, and it adds the 52
  skills of the pstack plugin by Lauren Tan, each as its own skill. Type `$pstack-poteto-mode`,
  `$pstack-why` or another `$pstack-<name>` to use one. Removing pstack removes them all.

### Changed

- Desktop notifications now show the start of the agent's reply when it finishes, the question when
  it needs your input, and the command when it needs your approval. Before, they showed only
  "Finished working.", "Needs your input." or "Needs your approval.". Secrets in the text are
  hidden. To show only the fixed text, turn off "Show message preview" in Settings → Notifications.
- An account can now have 50 hosted servers. Before, the limit was 3.
- A hosted server with a Slack, Discord or Telegram connection now sleeps after 15 minutes with no use,
  as other hosted servers do. Before, a live connection kept it on all the time.
- Long chats in the web app and on joined servers show the "Earlier" part of the day rail for messages that are not loaded yet, as on this computer. The server must run this version of OpenBot.
- Agents in one sidebar section now know their section teammates and send work to them first. To make agents work together, put them in one section.
- When you open an agent whose history is not loaded yet, the loading crew covers the chat until the
  history is ready. Before, a banner showed a Retry button that you could not use. A failed load
  still shows the notice with Retry.
- The chat now keeps the answer of a quiet routine run. Each routine run row opens and closes the
  messages of its run. A quiet run that has finished starts closed, a run that reported something
  starts open, and a run that is in progress stays open until it finishes. A quiet answer does not
  count as unread and does not change the chat preview.
- In Slack and Discord, a mention of a person shows that person's name to the agent, not an ID.

### Deprecated

- **Put agents that work together in one sidebar section.** Channels are no longer supported. OpenBot archives every channel when it starts and hides channels on the desktop, the web and the iPhone app. Agents in one section know each other and send work to each other first. Your channel history stays on your computer for now. The next release removes channels and their data.

### Fixed

- Keep a link in your own message readable when you put the pointer on it. Before, the link text
  almost disappeared into the bubble. A link that shows its full address no longer opens a tooltip
  with the same address.
- A remote connection that Signal refuses for a reason other than a rate limit, such as an invalid ticket, reconnects at once. Before, OpenBot waited 60 seconds as if Signal had limited its rate.
- An image you paste or drop in an agent chat sends again after you had a channel open. Before, the closed channel deleted the attachment as it arrived, and sending failed with "Attachment draft no longer exists".
- Claude background subagents keep running after the agent's turn ends. Before, OpenBot stopped the idle Claude process after 10 minutes and ended every subagent with "Stream closed", so long research had to start again.
- The live view of a remote server's browser now stops when you hide the browser, change the tab, or close a sign-in page. Before, the server kept sending the old view.
- A browser password request now shows the preview of its own page. Before, a slow preview of an earlier request could replace it.
- When a server connection was lost while OpenBot checked it, for example when you came back to the app, the status showed a short countdown before it connected again. Now it connects again at once.
- A Claude agent's answer after a background subagent or command ends now shows in the chat. Before, Claude wrote that answer, but OpenBot did not show it, because no message of yours had started the turn.
- The chat over the Routines canvas shows the agent's answer once, not twice.
- Start the channel task that has waited longest for the host first. Before, a busy channel could
  start its newer tasks again and again while an older task of another channel stayed queued.
- Wait between connection attempts to a team server that is offline. Before, the app tried again
  about once each second, and Signal could then block the app for a minute.
- The web client connects to a hosted server that starts within about 5 seconds after the server is ready. Before, it could wait up to 2 minutes between attempts.
- While a hosted server starts, the web client shows why the last connection attempt failed, with its error code.
- An owner or admin of a server sees its Slack, Discord and Telegram connectors in the web client's Server settings, as in the desktop app. Before, the web client showed only GitHub. A Slack or Discord install that the web client starts returns to the web client tab.
- OpenBot uses Electron 44.7.0. This update has V8 engine fixes that can stop rare crashes of the
  app while it is idle on macOS.
- A routine run that a local script or a webhook starts can now end quietly, as a scheduled run does.
  Before, OpenBot sent it as a Test run, so the agent always wrote a report. The run history now
  shows "Script" or "Webhook" for these runs, not "Manual".
- A client now connects again when it asks to start a hosted server that is stopping. Before, it
  stopped the reconnects and showed the server as offline until the next status check.
- Account sessions now show a hosted server with its name, as a hosted server. Before, the list
  showed it as "Desktop", so an owner could disconnect the server by mistake. Disconnect still signs
  the server out; a restart signs it in again.

## [0.38.0] - 2026-10-12

### Added

- URL MCP servers have a "Sign-in app" section. Enter the client ID, an optional client secret and optional scopes of an OAuth app that you registered with the server's provider. OpenBot uses this app when the server cannot register OpenBot by itself. The section shows the exact callback URL with a copy button. On a joined server, the host keeps the app and signs in with its own browser.
- On a joined server that supports it, you can now connect Codex, Claude, Gemini and Muse from your own computer. The sign-in page opens in your browser, and OpenBot sends the callback to the provider's CLI on the host.
- On a joined server that supports it, Server settings > Connectors now shows the host's GitHub, Slack, Discord and Telegram connections. You can connect, disconnect and reconnect them from your computer. The pages open in your browser, and the host keeps every token.
- When an agent on a joined server shows a sign-in link, for example for an MCP server of its CLI, the link opens in your browser and the sign-in finishes on the host.
- The Marketplace can now install an app that signs in with a browser on a joined server that supports this relay. The browser client can also connect providers and install these apps on a joined server.
- On a joined server that supports it, the sign-in page of a URL MCP server now opens in the browser of your own computer, not in a tab on the host. Your passwords, passkeys and existing sessions work. OpenBot takes the callback on your computer and sends it to the host, and the host keeps the grant.
- When your computer cannot take the callback of a relayed sign-in, OpenBot asks you to paste the address that the browser shows at the end of the sign-in. The browser client always uses this step.

### Changed

- A hosted server installs a new release by itself when it is idle and no member used it for 5 minutes. Automatic updates are always on for a hosted server.
- Show the words you dictate at the end of your draft, where they will go. Before, they showed as a
  separate grey paragraph under the draft and moved into it when the recording finished.
- Make the voice recording bar shorter, so the message box has more space for text.
- MCP sign-in now tries the same local callback port each time (28417), so the callback URL of a sign-in app stays the same. When the port is busy, OpenBot uses a random port.

### Fixed

- Show a moving bar and no percent while a server prepares an update or stages it. Before, the update
  notice showed "Downloading · 0%" for minutes while a cloud server waited for its disk after a resume.
- A hosted server that had a new release ready took more than 3 minutes to wake. It now wakes in about 20 seconds, as it does without a release.
- When an agent opened more websites in the built-in browser, or when you came back to the OpenBot window, the browser went back to the first website. It now keeps the website that you chose.
- A paste into the live view of a remote host's browser now goes to the page. Before, the paste
  went to the last text selection in the window, such as the chat input, or it was lost.
- A connection to a remote server that stayed open for 45 minutes asked the signalling service for new relay credentials many times a second, until the service closed the socket for a minute. The service could then also close the server owner's own host connection. OpenBot now asks once every 45 minutes, and restarts the network path only when it goes through a relay.
- When you refuse a relayed sign-in on a joined server, the command-line tool on the server now gets
  the refusal and stops at once. Before, it waited until its own time limit.
- The paste step of a relayed sign-in no longer says "this browser" in the desktop app.

### Security

- OpenBot keeps the client secret of a sign-in app in the encrypted sign-in store, shows only "Secret saved" after you save it, and removes it when you remove the server. Only an owner or admin can change a sign-in app on a joined server. A sign-in app is bound to the first sign-in server that accepts it, and OpenBot never sends it to a different one.
- The host relays an agent's sign-in link only when the link is an https page with a `state` that returns to a loopback address, and only when a message of that agent holds that exact link. A Slack or Discord grant goes only to the server whose install your computer opened, and only once. No connector route carries a token, and OpenBot does not log sign-in codes or grants.
- Only an owner or admin can start a relayed sign-in. Each relay completes once, only for the member who started it, and ends after 10 minutes. Your computer sends only the query of the callback. The host checks its `state` and never lets a client choose a host port or address. The page opens only when you click "Open sign-in page" in the dialog that shows its host name, and your computer refuses a page that has no `state`, so a host cannot use your browser for a grant you did not ask for. OpenBot does not log the sign-in code.

## [0.37.0] - 2026-10-11

### Added

- A scheduled routine has the setting "If OpenBot was closed at the scheduled time". "Skip this run"
  is the default. "Run once when OpenBot opens" starts one run for the most recent missed time.
- The run history shows the runs that OpenBot skipped while it was closed, as one row for each
  group, and marks a run that started more than one minute late.
- Connect the phone app to a self-hosted or Docker server. Run `openbot mobile-connect` on the server
  (`docker exec -it <container> openbot mobile-connect` in Docker) and scan the QR code with the
  phone app. Before, only the desktop app could show a Mobile Connect code.
- On this computer, you can log in to Grok, Cursor, Cline and Muse with a code, as you can for
  ChatGPT. On Linux, you can also log in to Claude with a code that you paste.
- When a browser sign-in that you start does not finish after 25 seconds, or fails, the provider
  row and the composer show a "Log in with code" button.
- On this computer, you can connect Gemini with a Gemini API key. Select Sign in on the Gemini row
  to save the key.
- Settings > Voice shows the dictation models. You can download, cancel, and select a model there.
- You can download Whisper large-v3 turbo (1 GB) as a second dictation model. It knows about 100
  languages. With Whisper, you can set the dictation language, for example Hungarian, or keep
  Automatic. Whisper writes the text when you stop, not while you speak. Parakeet stays the
  default and finds the spoken language itself.

### Changed

- German, Spanish, French, Japanese, Brazilian Portuguese, Russian and Turkish now translate all
  interface text. Before, some screens, errors and status messages showed English text.

### Fixed

- Claude agents keep their prompt cache when their saved memories change. Before, each memory
  change, such as a new memory that the agent saved, made the next turn write the whole
  conversation to the cache again. The agent now gets the change with its next message.
- Show "1 unread message" and "1 unread direct message" in the desktop sidebar. Before, these
  labels used the plural for one message.
- Translate open notifications again when you change the language. Before, a provider update
  notification and the close button of each notification kept the previous language.
- In the desktop app, an image that you paste or a file that you drop into a channel chat now
  appears as an attachment. Before, the channel chat ignored it, and only the attachment button
  worked.
- An agent whose plan ran out of usage can now change to a model of another provider. Before, the
  change failed with "Could not change model" while the agent held a queued message, and the agent
  stayed on the spent plan until it reset. The queued message now runs on the new model.
- Agents in a channel no longer read the thinking of other agents. Before, when one Claude agent
  in a channel had thinking text in its turn, Claude stopped every later assignment in that
  channel with a `reasoning_extraction` safeguard error until the channel summary covered the text.
  The channel still shows the thinking.
- The chat input keeps focus while agents work in the background. Before, a browser popup that an
  agent opened, or a browser tab that an agent or a page closed, took focus from the chat input when
  the browser panel was open.
- Keys that you type during a short provider restart or server reconnect are no longer lost.
- A click into the chat input that closes a popover keeps the focus in the chat input. Before, the
  focus went back to the button that opened the popover.
- Connect for Gemini now works on a Linux server that you joined, such as a Docker server. Before,
  the button did nothing. The server opens the Google page in its own browser, and you sign in
  through the live view of that page in the app or the web client. Only an owner or admin can do
  this.
- A finished agent reply no longer stays cut off after about 220 characters until the window is
  reloaded. This happened most often in a desktop app connected to another computer or server. A
  streaming reply also no longer loses its middle part while other agents work, and the Dynamic
  Island no longer cuts a reply that it already shows.
- After a joined server restarts, the first action on that server no longer fails with "Provider
  settings are not supported by this connection." Before, a second try was necessary.
- Let users close the usage-limit notice above the message box. Keep the current notice dismissed
  when they return to the chat, and show a notice again for a new quota window.

## [0.36.0] - 2026-10-10

### Added

- Polish interface. Choose Polski in Settings > General > Language, or keep System default on a
  computer that uses Polish. The web client uses it too.
- A computer that has not signed in to OpenBot now opens on a language wheel, before sign-in. Turn it with the arrow
  keys, the scroll wheel, a drag or the arrow buttons; the screen changes to each language as you
  turn it. Continue saves the language. The wheel shows one time on each computer.
- The diagnostics export now has the memory and CPU use of OpenBot and of each provider's
  processes, the app's responsiveness, database statement times and crash counts, for today and
  the previous day.
- With analytics on, OpenBot sends one daily summary of its memory and CPU use, by computer class
  and provider. It does not send process names, command lines or paths.
- Added a guide to run the Docker image as an AWS ECS service on EC2, with the seccomp profile, the
  data volume, ECS Exec sign-in and CloudWatch logs. AWS Fargate is not supported: it cannot keep
  the Electron sandbox on. See `docs/aws-ecs.md`.

### Changed

- The Docker image now works when `/dev/shm` is smaller than 1 GiB, for example on Kubernetes:
  Chromium then keeps its shared memory in `/tmp`. Before, Chromium could run out of shared memory.

### Fixed

- Completed the Brazilian Portuguese catalog: the 643 keys that showed English text — agent and
  provider settings, routines, webhooks, the routine canvas, billing, server states, the mobile app
  and the Marketplace — are now translated. `bun run i18n:check` reports pt at 6,676 of 6,676 keys.
- A server that gets a stop signal while its window loads now quits. Before, it showed a "failed to
  start" box on its virtual display, and the box blocked the quit until the process was killed.

## [0.35.2] - 2026-10-10

### Fixed

- Agents on Muse models, such as Muse Spark 1.3, reply again. In 0.35.0 and 0.35.1, each message
  to these agents failed with "Recursive JSON schemas are not currently supported".
- Keep the agent avatar inside the expanded Dynamic Island when the main window is zoomed in.
  Before, the avatar moved to the left of the panel and was cut off. The Computer Use rim and the
  permission help window also no longer change size with the main window zoom.

## [0.35.1] - 2026-10-10

### Changed

- The usage popover now shows each limit that a provider reports, such as the 5-hour limit and the weekly limit. Each limit has a bar, the percent left, and the time until it resets. Before, the popover showed only the limit with the least left.
- A failed connection to a server, the web app or a hosted server now shows a specific reason, for example when the server is busy, an invitation was already used or a firewall blocks the direct connection. Before, most of these failures showed "The connection failed."
- Error messages and error notifications show a short error code with a copy button. Send this code when you report a problem, so we can find the cause.

### Fixed

- A hosted server no longer stays at "Starting" with "Too many active remote connections." Before, the phones, browsers and desktops of an account could use all of its remote connections, and the server could not connect. Now only device connections count toward the account limit.
- The server connection screen shows its errors in your language. Spanish now has the text of this screen.
- The server menu on the sidebar title now shows all of its width while a server sleeps, wakes, or connects. Before, the loading screen of the server covered the part of the menu that went past the sidebar.
- The web app connects again by itself when a server comes back after an update or a long restart. Before, the page could wait up to two minutes before it tried again, and you often had to reload it.
- A device that was connected when its server restarted no longer stays at "Loading" until you reload.
- A server that lost its remote connection for good no longer shows as online while no device can reach it. The server now reports an error, and a cloud server connects again by itself.

## [0.35.0] - 2026-10-10

### Added

- An owner or admin can turn Computer Use and Local scripts on or off for an agent, and select what a message does while the agent works, from the OpenBot iPhone app.
- On macOS, you can reply to an agent, answer its question and stop its work from the Dynamic Island. The main window stays where it is. "Open chat" still opens the conversation.
- Add native Pi RPC and Muse MSP providers, managed runtime downloads, and host sign-in.
- Add ACP provider settings with saved overrides, deferred changes, and reset.
- Add ACP registry search, install, update, cancel, and runtime removal on the selected host.
- Apps connected to a server that runs this version can manage its providers and ACP agents. Custom agents keep their IDs and sessions.
- An owner or admin can sign in to an MCP server that uses OAuth on a joined server, from the desktop app or the web app. The sign-in page opens in a private tab of the host's browser and shows in the settings. The token stays on the host.
- The file preview panel has a Copy button for text, code, Markdown and HTML files. It copies the full source of the file, also for Markdown and HTML that the panel shows rendered.
- The file preview panel now highlights code files, such as JSON, TypeScript, Python, YAML and diff files, with the same colors as code in chat. Files larger than 200,000 characters, or with a line longer than 5,000 characters, stay as plain text.
- The file preview panel has a wrap button for text files and source views. When it is on, long lines wrap to the panel width, so you do not have to scroll sideways. The app remembers your choice.
- Agents can search saved memories and list them for maintenance. Essential memories use a fixed prompt budget.
- You can choose which memories are always included, which need search, and which the agent can select.
- Show selected release notes after a desktop update. Updates that skip versions show the selected notes together. Close the dialog to continue, or open it again from Settings > Updates. A new installation starts without the dialog.
- Add Cobrain to the Apps catalog. Agents can load, search and save notes in your Cobrain memory
  after you sign in to your Cobrain account.

### Changed

- The agent settings panel shows the face, name, title and instructions at the top of the list, as
  the iPhone app does. You no longer open separate Profile and Instructions pages. Click the face to
  change the image, the generated face or the color.
- The right panel cannot be narrower than its default width, because a narrower panel breaks its
  layout. A panel that you made narrower before opens at the default width.
- The instructions field of an agent and of a channel has a fixed height. Long instructions scroll
  inside the field. Before, the field grew and had a resize handle that did not match the field.
- Voice input now uses NVIDIA Parakeet TDT 0.6B v3 in place of Whisper. The words show in the
  message box while you speak, and the full text replaces them when you stop. Parakeet supports
  25 European languages. Japanese, Chinese and Korean dictation is no longer available.
- The first voice recording downloads a new model of approximately 670 MB. OpenBot deletes the
  old Whisper files.
- While you speak, the microphone button changes into a recording bar with a live waveform.
  The waveform shows small dots in silence and taller bars when you speak.
  ✓ puts the text in the message box, × discards the recording, and the send arrow sends it.
  The message box no longer gets a yellow outline during a recording.
- Local scripts can send messages, read pending questions and approvals, and submit responses. Agents with Local scripts already enabled get these operations after upgrade without a new opt-in. Browser takeovers and secret questions direct the user to OpenBot.
- Owners and administrators can turn Local scripts on or off from a connected desktop or web client. Scripts run on the host, so a headless server needs no local screen.
- Existing memories stay saved. During upgrade, recent manual memories receive priority for the essential prompt budget.
- Remote memory selection uses bounded pages. Older hosts keep memory text editing without the new controls.
- A scheduled routine run can now end without a message when the agent calls the new
  `routine_no_update` tool. Before, the run stayed quiet only when the answer was exactly
  `[[no-update]]`, and an answer such as "Nothing new." sent a notification. The marker still
  works. A Test run still shows its answer.
- Agents use less context. They load the details of most tools only when they need them. All tools stay available.
- When an agent changes provider, it gets a shorter part of the conversation. It can still read the older messages of the same conversation. A context reset still hides earlier messages.
- A change of the Claude model or reasoning effort no longer starts a new Claude session.
- A ring near the message box shows how much context the agent uses. The conversation shows when the agent compacts its context. Claude values are estimates.

### Fixed

- A paste into a remote desktop now pastes your own clipboard on the host. Before, Cmd+V or Ctrl+V pasted the host's clipboard.
- The embedded browser now removes the OpenBot and Electron user-agent tokens for sites such as X and LinkedIn, and sends basic client hints for its Chromium version and platform. Google account requests keep the compatibility token needed for sign-in.
- The owner of a server can now remove it from the account with Remove server, in the server menu or in server settings, also when its computer is offline or gone. Before, an owner could not remove such a server, and it came back on each computer and after each reinstall. The removal applies to all members and all devices. Members lose access, and connected Slack, Discord, Telegram and webhook routes stop. If you add the server again, invite its members again and set up its connections again. Old webhook URLs do not work again. Files and chats on the server's computer stay.
- Keep chat input focused while another agent uses the browser. Background browser actions could interrupt typing.
- Keep chats at the latest message when switching agents. Measurements of routine cards and other messages could move the chat away from the bottom.
- Custom ACP agents can recover from a closed session when you send a new message. Before, messages could repeatedly fail with `Internal error`. Startup errors now show provider details with secrets removed. Recovery keeps the conversation and does not repeat a failed prompt.
- Codex now saves “Always allow” approvals for custom MCP server tools and applies saved approvals after a restart.
- An agent whose provider says "You've reached your weekly usage limit" now waits for the limit to
  reset, as it does for "You've hit your weekly limit". Before, each queued message and routine run
  started a turn that failed.
- Switch chats while OpenBot changes which queued message you edit, and each chat now keeps its own draft. Before, the first chat could get the other chat's draft and lose its own.
- A voice message sent to one chat while you read another no longer scrolls the chat you read to its latest message.
- Close the chat search or clear the query while a search is running, and a late result no longer opens an old match, possibly in another chat.
- If a voice recording fails to start after the microphone opened, OpenBot now releases the microphone. Before, the microphone stayed in use.
- A Stop that arrives after its turn ended no longer stops the next turn of the same agent.
- A file or site folder whose name starts with two dots, such as `..notes.md`, now opens or publishes from the workspace. Before, OpenBot refused it as outside the workspace.
- If saving the preview of a sent message fails, the message is still delivered. Before, it stayed in the queue until the next restart or queue event.
- A routine set to repeat every 58 or 59 minutes is now refused when you save it, like every other schedule under the 3-minute minimum. Before, it ran twice within 1 or 2 minutes around each hour. Routines already saved this way keep running and can still be edited.
- The sidebar section name field keeps focus after you choose New section or Rename. Before, the field could lose focus and the name was lost.
- Remote Control keeps its stream when another server changes, for example when it goes offline or you mute it. Before, the view changed to "Remote access expired".
- Text you type in a direct message stays when someone on the server starts typing to an agent or connects. Before, the message box cleared and the conversation scrolled back.
- Deleting a routine now also removes the work it queued and nobody started yet, in agent chats and in channels. Before, that work could still run after the routine was gone. Channel work that already started keeps running and can be stopped as usual. Deleting an agent routine still stops its active turn.
- Files attached to a channel message are no longer lost when the channel is archived while the message is being sent. You can send them again.
- Stopping or reassigning a channel task while it was being handed to a member no longer gets undone when that hand-off fails.
- Show Gemini replies as they arrive while Antigravity background tasks run. Stop now ends the local turn, saves unfinished tool calls as interrupted, and restores the same provider session before the next message.
- A queued message now appears at the point where you select Steer, after the commentary sent while it waited. Its position stays the same after a restart.
- Show when a queued message is held for editing, including after restart, and add a Cancel edit button.
- Keep pending messages visible when no agent turn is active, so users can edit or cancel them.
- Two attachments whose names differ only in case, such as `Report.txt` and `report.txt`, now both arrive. Before, on macOS and Windows the second file overwrote the first, and the first attachment could not be opened.
- A Claude turn that ends on an API error, such as an expired sign-in, a low credit balance or an overloaded service, now fails and shows the error. Before, the error text was saved as the agent's answer and the message counted as delivered.
- When an agent cannot attach a file to its answer, it now gets the reason, for example a file outside its workspace and the shared directory, and can correct the call. Before, Codex agents got only `dynamic tool request failed` and retried the same call.
- A Codex agent on a Plus or Pro plan now waits for its usage limit to reset. Before, the limit message offered more credits, so OpenBot took it for a spent balance and started each queued message and routine run, and each one failed.
- Grok agents answer again after their Grok CLI restarts. Before, every message to the agent failed with `Invalid params` after an idle stop, an OpenBot restart or an update.
- Fix remote reconnects that report too many active connections when an old client socket waits for its host. Concurrent reconnects and failed authentication no longer hold extra account slots. Other device sessions stay connected.
- Wait before reconnecting when Signal limits connection traffic. Before, repeated retries could keep all devices on an account disconnected.
- Gemini shows its sign-in and start errors. Before, it could show Ready when it could not run.
- Restart works while a Gemini sign-in waits. Before, the old sign-in could stop the next attempt.
- On Linux, Gemini sign-in opens in the desktop browser. When no browser opens, OpenBot shows the setup steps. Before, it waited until the sign-in expired.
- Remote provider settings explain that Gemini sign-in opens a browser on the server's computer.
- The message box and its queue stay below an approval request or a browser takeover. A message that you send while an agent waits for your approval now shows in the queue. Before, the message box went away, and a queued message was not visible until the approval was done.
- When an agent refuses a request, OpenBot now shows the reason that the agent sends. Before, a Grok agent showed only `Invalid params`, for example when Grok refused a session resume after its CLI restarted.
- Messages stay in the queue when you try to steer a provider that does not support it. Custom ACP agents no longer receive a second prompt that can interrupt the running task or lose the queued message.
- Recover the affected remote peer when a host data channel closes. Other connected clients stay connected.
- Report failed Live View connections and invalid frames as failures. Close failed views so they can be opened again.
- A queued channel task now starts when the agent or normal work that held it becomes free, also when that work ended without a turn, for example when a message failed to start or was cancelled. Before, the task could stay queued until the next channel command or a restart of OpenBot.
- A message from an agent with an empty reply id no longer stops the sender's and the recipient's
  conversations from loading or stalls the recipient's queue. Conversations that an earlier version
  saved with such a message load again.

### Security

- The Bun runtime that OpenBot downloads to start MCP servers is now version 1.4.3, which has security fixes.

## [0.34.1] - 2026-10-09

### Changed

- The mobile app card at the bottom of the sidebar now says "OpenBot for mobile", because the app
  is on iPhone and Android. "How to install" opens Settings > Mobile Connect, which shows the steps
  for both phones. If you closed the old iPhone card, the new card shows one more time.

### Fixed

- The message box stays at the bottom of the chat again. In a short conversation it moved up to sit
  directly below the last message.

## [0.34.0] - 2026-10-09

### Added

- A Routines view in the sidebar. Open an agent to see its routines on a canvas: when each one runs next, its last runs, and what each agent received and answered in the last run.
- Routine flows. On the canvas, connect one agent to another inside a routine, and the routine sends the first agent's answer on to the next agent when it runs. An agent with several inputs waits for all of them. Routine flows are available for agents on this computer.
- Ask an agent to edit the canvas. The chat panel on the Routines view sends your request to the open agent, which can add or remove routine links, and create or change routines, with its tools.
- Change an agent's task in a routine from the routine details panel. For the routine's own agent, this changes what the routine asks for.
- Right-click the routine canvas to add an agent at that spot: one you already have, or a new one with its name, what it does, and its model.
- Webhook routines show on the routine canvas. Their details set the webhook: copy the endpoint, regenerate the signing secret, and choose the event type and filters that start a run. Run now tests them.
- All signed-in server members can check for releases and request an idle update on supported installations. Administrators keep control of cancellation, forced restarts, and automatic-update settings.
- Turn built-in providers off or on in this computer's provider settings. OpenBot saves the choice, stops unused provider processes, skips their CLI checks, and removes their models from the picker. Change an agent's model before you turn its provider off.
- Russian interface. Choose Русский in Settings > General > Language, or keep System default on a
  computer that uses Russian. The web client uses it too.
- Add Spanish and German to the language settings. Translate desktop and web-client screens,
  including setup, agent controls, routines, files, connections, status messages and errors.
- The server menu on the server rail and on the sidebar title now has "Leave server" for a server that you joined and "Delete server" for a server that you host. The desktop app and the web client both show these actions.
- Update a hosted server, or a server that you installed on Linux, from Server Settings > Updates.
  Download, **Update when idle**, **Restart now** and automatic updates now work there as on a
  computer. Before, the server got a new release only when it started again.
- Remove an old server that you own from the web side panel, even when its computer is offline. Removal ends remote access for all members and keeps files and chats on the computer. Paid hosted servers still use Billing.
- Let a scheduled run of an agent routine stay silent when it has nothing to report. Ask the agent in
  the routine task to answer `[[no-update]]` in that case. When every answer of the run is only
  `[[no-update]]`, the run posts no message, adds no unread message, does not change the chat
  preview and shows no notification. The run marker stays in the chat, and the run stays in the
  routine **History**. Test runs, and script or webhook runs, always show their result.
  The browser client, the phone, and a desktop connected to a remote server stay silent for a
  quiet run too. An older client shows the run as finished, as before.
- Sign in to a custom Streamable HTTP MCP server in your browser, for servers such as Granola that
  use OAuth. Choose Sign in on the server's row or in its form. The panel shows that it waits for the
  browser, lets you cancel, and marks the row Signed in. Sign out deletes the stored sign-in.
- The Custom tab of the model picker now has an "Add provider" button. It opens the Providers
  section of the server settings, where you add an endpoint. Before, the tab had no way to add one.
  The button shows on this computer, and on a host where you are an owner or admin.
- The iPhone and Android apps have their own download pages, `/download/ios` and `/download/android`,
  with the system requirements, the install steps and how to connect the phone to your computer.
- Telegram: add the OpenBot bot to a Telegram group or start a direct chat with it from **Server settings → Connectors → Telegram**. People mention the bot or reply to it, and the Telegram Orchestrator asks the right agent and posts the answer in the same reply chain, with approvals, stop and files as in Slack.
- OpenBot sends the page's mouse cursor to the mobile app, which shows it on the live browser view.
- A right-click from the mobile app opens the page's menu on the phone, not on the screen of the
  server. While the phone shows a tab, the page keeps one size, so it does not change shape when
  the OpenBot window changes size. A tab that an agent gave its own size keeps that size.
- Choose how many memories each agent can keep, from 64 to 512, in Settings > General. A lower limit keeps all saved memories.

### Changed

- Update the Bun development and build toolchain to 1.4.2 across desktop, mobile, and server workflows. **Developers must install Bun 1.4.2 with the command in the README before they start development.**
- The Routines tab of the sidebar shows only agents. Channels have no routines, so they stay in the
  Agents tab. When you open the Routines tab, an open channel closes.
- Development commands can start without shared secrets and load the encrypted shared development settings when the developer has the development key.
- Local development identity and overrides persist in ignored state, and the APNs helper writes to that state.
- Encrypted development settings use `.env.dev` and the shell key `DOTENV_PRIVATE_KEY_DEV`; production settings remain unchanged.
- The update resets old generated `.env.dev` settings. Existing identity keys and overrides in `.openbot/dev-state.json` remain unchanged.
- Development commands keep account and decryption secrets out of browser and tunnel processes, and secret-dependent E2E commands check required keys before changing test data.
- New hosted servers start from a snapshot built from the latest completed desktop release. Releases now build and select the production boat snapshot automatically. Failed snapshot builds keep the previous template active.
- Marketplace app listings in Russian. The tagline, description, server description and example
  requests of each catalog app now follow the interface language. Before, they were always in
  English.
- Manage paid servers in Billing on desktop and web. Cancel renewal and keep the data, stop a
  scheduled deletion with Keep server, or delete a server now or after its paid period.
- Remove the shadow from confirmation dialogs.
- Settings has a Notifications tab for desktop notifications, the test notification and sounds.
  General is shorter: Language is first, and the settings are in four groups with shorter text.
- Consecutive completed runs of one routine show as one row in the chat, with the number of runs and the time of the first and the newest run. Open the row to see each run. A run that fails, stops or needs attention keeps its own row.
- Set the default provider for new local agents in Server settings → Providers. Computer permissions remain in Settings → Computer Use.
- Open a joined server faster when OpenBot starts. The window no longer waits for the account's
  server list, the selected server connects while the window loads, and the hidden connection window
  loads while the session is made. A server that has no saved key still waits for the server list.
- Write the time of each step of a connection to a joined server to the local trace file, for
  diagnostics. The trace does not name the server.
- Connect to a joined server faster when OpenBot starts again. The app keeps the server's remote
  session between runs, so the start asks only for a new ticket. It opens the Signal connection while
  it waits for that ticket. The kept session is encrypted, and the app forgets it at sign-out or when
  it starts with no account signed in.
- Add Settings → General → Fast connection to servers, on by default. Turn it off to end each remote
  session when OpenBot quits and to keep nothing between runs, as before.
- Write the time when the Signal connection opens to the local trace file
  (`remote-connect:signal-socket`).
- When you turn on Settings → General → Fast connection to servers, OpenBot also keeps the remote
  sessions that are open at that time.
- When a remote connect fails before it gets its ticket, OpenBot closes the Signal connection that
  it opened early.
- Moved Publish from the chat header to the agent side panel. Click the agent name to find it.
- The search field in the sidebar now opens the global search, the same as Cmd+K (Ctrl+K). It no longer filters the sidebar list.
- The agent settings panel is shorter. It shows the profile, the instructions, and the model, Knows,
  Does and Rules groups. Each group row has an icon. Profile, Instructions, Permissions and Advanced
  open on their own page; the back button returns to the list.
- On the web, the loading crew now covers the chat while a hosted server wakes. When the server is online, the crew jumps out and the chat shows.
- Test connection no longer opens a browser. It uses the sign-in that this computer already has, and
  a server that asks for a sign-in shows a Sign in button.
- A failed test now says what kind of failure it was: a sign-in is needed, the server refused, the
  URL is wrong, the server did not answer, it did not start, or it could not be reached.
- Group the models of a custom ACP agent by the provider that serves each one. An agent that lists
  `<provider>/<model>` names now shows one section per provider in the model picker, instead of a
  single undifferentiated list.
- The changelog page names the mobile app "OpenBot Mobile", because the app is now also on Android.
  Next to the TestFlight link, a button opens the Android app on Google Play.
- The download section of the home page and the `/download` page have iPhone and Android tiles,
  in the same style as the desktop tiles. The links to the requirements pages show iPhone and
  Android in a separate group after macOS, Windows and Linux.
- Run independent CI checks and browser setup steps in parallel, with separate logs for each step.
- Remove the large package-cache restore from CI setup.
- In a file attachment card, the download and open icons are smaller.
- Let long message drafts grow to one-third of the window height before scrolling. Keep the cursor visible when the input size changes.
- Show install steps for Android in Settings > Mobile Connect. Choose iPhone or Android to see the
  QR code and the steps for that phone: the Google Play listing for Android, or the TestFlight beta
  for iPhone. The two cards are numbered, so you install the app first and then sign in. The list
  of connected phones shows the logo of each platform.
- Show the platform logo, a link and the OpenBot logo in the middle of the install QR codes.
- Show what a hosted server gives at the top of the add-server dialog: it runs OpenBot 24/7 on an
  external server, keeps agents and routines running when the computer is off, and needs no
  technical setup.
- Telegram: code blocks in answers keep their language, such as `python`, so Telegram colors the code.
- First run now asks one question, with two equal answers: "Start free", or "I have a subscription"
  (ChatGPT, Claude or Grok). "Start free" needs no subscription and no sign-in: your agents use the
  free models of OpenCode, which starts to download when first run opens. Before, you had to find
  OpenCode at the end of the provider list.
- First run has fewer steps. With "Start free", the only other step on macOS asks for the Computer Use
  permissions. The sound and example-job steps are gone. You can still choose sounds in Settings.
- First run changes steps calmly: the old step blurs and fades out, and the next one comes into
  focus. When setup is done, the setup screen blurs away into the app. With reduced motion, the steps
  change at once.
- When you open OpenBot from first run before the free models are ready, a splash shows: the agents
  from the first screen jump in a slow wave, and a line under them fills with the download. The app
  then opens from the splash. Before, a small spinner showed in a button.
- The agents on the first screen and on the splash follow the pointer with their eyes. An agent
  grows a little under the pointer, and nods when you click it. With reduced motion, they stay still.
- In the setup provider list, ChatGPT, Claude and Grok show their version under the name, not
  "Included with OpenBot". Before, an "Update available" badge cut that line off.
- The sign-in screen says that the email address also creates an account, and that your chats and
  files stay on the computer that runs OpenBot.

### Removed

- Removed the repeated Providers & permissions screen from the account menu. First-run setup remains available.
- Remove the outdated Product Hunt launch banner from the landing page.

### Fixed

- Open Settings on the Hosted servers tab at once from "Manage servers". Before, the dialog showed
  another tab first and then jumped when the server list loaded. A slow list now shows a loading
  indicator, and a list that fails to load shows its error on the tab.
- OpenCode models with no reasoning setting, such as Big Pickle, Kimi, MiMo and Nemotron, now show "Set by OpenCode" in agent settings. Before, the Reasoning control showed "Medium" as the only level, but OpenBot sent no level and OpenCode used the model's own default. Other ACP agents, such as Cursor, show the same "Set by" text for a model that has no reasoning setting.
- OpenCode MiniMax M3 now offers Low (thinking off) and High (thinking on). Before, it offered only Low, so thinking could not be turned on.
- Remote hosts can check for compatible OpenBot releases even when they cannot update themselves. Server Settings shows the installed and latest versions, explains the correct update path for hosted servers, system services, containers, and Host Manager installations, and hides installation controls that cannot work.
- Server update status refreshes after a lost connection and does not show a reply from a previously selected host.
- Show the latest message of a chat or channel in the sidebar as plain text. Before, the preview
  showed raw Markdown, such as `**2 new emails**` with its asterisks, while the chat itself showed
  the same text in bold.
- Show "Connecting…" in the sidebar and the message box while a joined server connects after you
  open OpenBot. Before, the app showed "Create your first agent" and asked you to complete agent CLI
  setup for some seconds, until the server sent its agents.
- Grok chats keep their message order after a reload and when you load older messages. Before, a message that you sent while Grok worked could show above Grok's answer to the message before it.
- A message that you send to a running turn now shows after what the agent did before it. Before, it moved up to the turn's first message.
- Grok's thinking after a tool call shows as its own step. Before, it joined the thinking from before the tool call.
- When you read a chat through an event that came while the agent worked, the agent's answer above it is read too. Before, it stayed unread.
- Agents on a custom ACP provider can send messages to teammates and stop their work again. Before,
  the message failed with "The idempotency key is too long."
- Cancelling a browser task no longer shows the raw Codex tool cancellation error. Pending browser work stops, incomplete new tabs close, and existing tabs remain available for the next request.
- Reduce idle animation work for active tasks and pending replies. Pause their repeated animations when the window is hidden or the rows are closed.
- File chips can now find files outside the workspace from recent ACP and Claude file tool calls. Previously, a chip with only a file name could report a missing file. This lookup is local to the desktop and requires Full access. The last 200 paths per thread stay in memory until OpenBot closes.
- Return keyboard focus to the server control after a confirmation closes.
- Prevent a server connection from closing with “Signal message is invalid” when the browser sends an empty ICE completion marker.
- The web app now opens the last server you selected in that browser. Each account keeps its own selection.
- Keep a deleted agent deleted when another device still shows it. Before, opening its chat or
  marking it read on that device created the agent again, with an empty chat.
- Test or delete a webhook routine on a remote server without losing the connection. Before, the app
  read the host's empty answer as unsafe data and stopped every request to that server until you
  chose Retry.
- Show routine times on a 24-hour clock when the date format of the computer uses one, such as
  French, Japanese or Russian. Before, the schedule summaries, the time chip and the time editor
  always used AM and PM.
- A server that wakes from sleep no longer shows "Set up" with the provider choice before its agents
  load. Before, the server sent an empty agent list while it started, until a reconnect sent the
  agents.
- Keep a deleted agent deleted when another device reacts to its message, stops its turn, or steers a
  queued message into its turn. Before, these actions created the agent again.
- OpenBot starts when an unsent message with a skill or MCP server tag is saved in the message box.
  Before, the app stayed on the startup logo at each launch until you removed the saved draft.
- Copy, cut, paste and select all now work in the browser of a remote server, with Ctrl or Cmd and
  C, X, V and A. Before, the shortcuts did nothing: the page used the clipboard of the server, not
  your clipboard. The server must also have this update; an older server shows a message that tells
  you to update it.
- Keep the conversation usable when Cursor reports a missing provider session as "Invalid params". OpenBot now uses its saved conversation to continue in a new provider session.
- When you close the global search with Escape, focus goes back to the control that had it before.
- On the web, a hosted server that sleeps or wakes no longer shows a connection error.
- A custom MCP server that asks for an OAuth sign-in no longer shows "The server answered 401. Check
  the API key or other credentials." It now asks you to sign in. An `http://` address for such a
  server tells you the `https://` address to use, and a test from another computer tells you to sign
  in on the host.
- A STDIO server that stops before it answers now says so, instead of a timeout. A command that runs
  the `mcp-remote` bridge points you to Streamable HTTP with the same URL.
- When Approve, Decline, an answer, Take over or Open details fails in the Dynamic Island, the
  island now stays open and shows "That did not work. Try again." next to the buttons. Before, the
  click did nothing that you could see, and the agent stayed blocked.
- When a message or file search fails, the search window now says "Search did not finish. Some
  results can be missing." and shows a Retry button. Before, a failed search showed "No results",
  and a failed next page stopped the list with no message.
- In a language other than English, the Cancel button of many confirmation dialogs, the Copy and
  Copied labels, and the name that an agent gets when you clear its name now use your language.
  Before, they stayed in English.
- Server settings now ask before they change a member's role or revoke an invitation. A role
  change can disconnect the member from the server. Before, one click in the menu or on Revoke did
  the action at once.
- Disconnecting 1Password, or an app from the Marketplace, now asks for confirmation first.
  Before, one click forgot the 1Password token or removed the app and its skills.
- The Computer Use rim no longer shows over the OpenBot window. When the window that an agent works
  in is behind OpenBot, OpenBot now covers that part of the rim, as other windows do. When OpenBot
  covers all of that window, no rim shows.
- Center the agent avatar with the name in the profile card of the agent settings panel, and center the
  avatar on the profile page.
- Antigravity no longer shows "Provider error" notifications for a failed MCP tool call or a timed-out OpenBot browser call. The agent gets the failure as the tool result and can try again.
- When an agent calls a memory tool with missing text, text that is too long, or a memory ID that it cannot use, the agent now gets a failed tool result that it can correct. The user no longer sees a "Provider error" notification.
- Keep the connection to a server when a desktop client that is connected to it reconnects to the
  signal server while the connection still works. Before, each such reconnect restarted the
  connection path, and after 10 restarts the server closed the connection. The chat then stopped
  for a few seconds while the client connected again.
- Let a desktop client stop an agent on a remote server after the computer wakes from a long
  sleep. Before, the server could close the connection during the sleep while the client still
  showed it as connected. Each stop then failed with "The WebRTC channel is not open." Now the
  client connects again when the server closes the connection. When a request could not go out on
  the closed connection, the client sends it again on the new connection.
- An OpenCode CLI update no longer stops with only "fetch failed" after the download completes. OpenBot now gets the OpenCode license from npm, the same place as the CLI, so the update needs no GitHub connection.
- When a runtime download request fails, the error now shows the address and the network reason.
- A Retry after a failed runtime install now uses the download it already has when that download passes its check, and does not download it again.
- Read the history of a custom ACP agent from its process. Before, startup could stop with "Cannot
  read properties of undefined (reading 'options')" and the local agent backend did not start, and a
  read of the agent's conversation history could fail with the same error.
- OpenBot reads your joined servers again when it opens before your account finishes loading.
  Before, the first read could stop with "Sign in to OpenBot first.", and the server list did not
  update until a later check. In 0.33.0, OpenBot could fail to start with this error.
- The installed OpenBot web app now opens the app at `/app`. Before, it opened the landing page.
- Connect Figma, or another MCP server on this computer, no longer stops with only "fetch failed".
  When nothing answers at the local address, the dialog tells you to turn the server on in its app
  and try again. A connection that this computer blocks, or an address that answers but is not an
  MCP server over Streamable HTTP, now has its own message.
- In an attachment card, the download and open icons now have the same size and alignment.
- OpenBot stays open when a Browser tab opens the Chrome Web Store. Before, the app could close a
  few seconds after the page loaded, and again at each start while the tab was saved.
- Keep the message cursor in place when you add or end lists, insert blank lines, or update attachments. Line breaks and multiline paste now work with undo and redo.
- Keep text selection and arrow-key movement stable when you use inline tags or leave a suggestion list.
- Dragging in the live browser view of a remote member now selects text and moves sliders. Before,
  the page released the mouse button at the first movement.
- When a phone or another computer answers an approval or a question that is no longer waiting, the server now says that the request is closed. Before, it showed a general "Request failed" error.
- Show clear loading and recovery states for remote servers on desktop and web. Keep loaded conversations and drafts visible during temporary connection loss.
- Retry web connections automatically, report hosted-server start failures, and let Retry start a sleeping server again.
- Limit initial remote reads so a server that does not respond cannot leave the workspace loading indefinitely.
- Copying selected message text keeps agent, skill, and file references on the same line. Reference names are no longer missing from the copied text.
- Show channels in the sidebar again after the desktop app starts, or after it connects to a remote
  server again. Before, the sidebar showed only agents, and **New agent or channel** offered only a
  new agent, until the app window lost focus and got it back.
- A phone or another peer that cannot see an agent (a custom ACP agent before protocol 5, or a
  Cursor or Cline agent before protocol 6) now gets the channel list when one of the channels is
  led by that agent. Before, the whole list failed and the phone showed no channels. The channel
  shows with the members the peer can see and no lead.
- Saving such a channel from that peer, for example a rename, keeps the hidden members and the
  hidden lead. A lead the peer picks itself still wins.
- Keep remote routine runs quiet through a new optional capability. Older clients still receive the released turn completion event.
- Remove Telegram chat links and unused link codes when you remove a server from your account. Other servers keep their links.
- An agent with a full memory now gets an error when it tries to save one more memory, and it can
  merge or forget a memory in the same turn. Before, the new memory was lost when the turn ended.
- Show a Gemini rate limit or spent quota as an error that says to wait or choose another model.
  Before, the turn failed with no message, because OpenBot waited for a usage reading that Gemini
  does not send. A model that Gemini cannot use and a Google service failure also get their own
  message.
- Say "Not reported" for Gemini, Cursor, Cline and custom ACP agents in the usage menu. These
  providers have no usage reading, so the menu showed "Unavailable" as if the reading failed.
- Stop starting Gemini, Cursor, Cline and custom ACP agents only to read their usage. Each usage
  check started the provider for a reading that is always empty.
- Retry a provider start when model discovery times out, as other start timeouts do.

### Security

- Update remote-desktop dependencies to fix reported security vulnerabilities.

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
