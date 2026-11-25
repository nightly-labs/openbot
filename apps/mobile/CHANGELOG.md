# Changelog

All notable changes to the OpenBot iPhone app will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md). The changes of the desktop app and the web client are in
the [root changelog](../../CHANGELOG.md).

## [Unreleased]

## [1.4.14] - In review

### Added

- Server owners and admins can set "Threads at the same time" and "Parallel threads per agent" in Server Settings > Agents. Before, only the desktop app had these settings. When someone changes them on another device, the new values show immediately. For the immediate update, the server must also be on the new version.
- You can hide a server from the server list. The hide applies to your account, so the server is also
  hidden on the desktop app and the web client. Hidden servers are in the "Hidden servers" group,
  where you can show them again.
- You can remove the server of one of your computers from the server list and from the server
  settings.
- You can make a one-time routine on the phone: in "When to run", select "Once", then select the date
  and the time. The server must have a version that shows one-time routines in the schedule.
- Settings > Conversations has a new switch, "Use the full-screen camera". When it is on, Camera in
  the chat opens the system camera, with zoom and all lenses, instead of the small camera in the chat.
- The small camera in the chat shows a tip one time. It tells you about the full-screen camera, and
  one tap turns it on.

### Changed

- When you sign in to an MCP server or connect an app, and you must paste the address back, the steps now say that the last page does not load and that this is correct. Before, only the provider sign-in said this.
- The chat list on Home has larger avatars and larger text. The title of an agent or a channel is now
  on the same line as its name, so each row shows the name, the title and the last message in two
  lines. When a long name leaves too little room, the row hides the title and keeps the full name.
- The unread badge is closer to the avatar and does not get larger with the avatar.
- Pinned agents and channels show only their names, without their titles.
- In a chat with an agent, a new progress update now fades in, as other new messages do. Before, its
  full text appeared at once. With Reduce Motion or the text reveal setting off, it still shows at once.
- Pinning and unpinning a chat with a swipe or the menu now moves at once. The pinned chat pops into the pinned grid, and the row slides out of the list. An unpinned chat slides back into the list. Before, the avatar stopped for a short time and then moved across the screen, and the list could jerk.
- In Server settings, the server picture has an edit button. It opens a new page where you add,
  change or remove the server logo, and select the shape and color. Server settings no longer show
  the shape and color picker.
- Home shows chats closer together. Each chat row is shorter, and a section title now has more space above it and sits directly on its own chats, so each section reads as one group.

### Fixed

- An answer on a question card goes to the server of the agent. Before, when you had more than one server and the selected server was offline, an answer to an agent on another server failed with "Couldn't send your answers. Please try again."
- On Android 11 and earlier, GPT live voice now plays through a connected Bluetooth headset and uses
  its microphone, as a phone call does. Before, the reply and your music moved to the phone speaker
  when live voice started.
- A file that you tap in the Library or in a chat now opens quickly. Before, it waited until all pictures on the screen were downloaded.
- The Claude plan limits on the Usage screen no longer disappear for some minutes and then come back. The computer or server that the phone connects to must be on the new OpenBot version.
- An agent that you create on the phone with "Server default" no longer starts on a model that you
  hid in model visibility. It starts on a visible model, if the server is on the new version.
- In GPT live voice, your message in the chat now shows what you just said. Before, it could show your
  previous sentence. The computer or server that runs the agent must also be on the new OpenBot version.
- With VoiceOver or TalkBack on, the Home and Chat screens can be used again. The hidden "Close server drawer" button no longer covers the screen while the server list is closed.
- When you open a thread from a notification, or go back to the app, the thread now shows the replies that came while the app was in the background.
- When the connection to a server stops sending data, for example after a change from Wi-Fi to mobile data, the app now connects again by itself. Before, the server stayed online, but chats did not load and replies did not come.
- A chat video or audio file that stopped downloading when you left the app, or when the connection
  to the server was lost, downloads again when the server is connected. The card shows the progress
  of the new download. Before, the card kept a technical message such as "The app is in the
  background." until you tapped Retry.
- When a server uses its own copy of a provider, such as Claude Code, the provider page no longer shows "Not downloaded". It shows the version that runs and the Connect button.
- On iPhone, Save to Files for a chat file now opens the share sheet, where you tap Save to Files or Save Video. Before, after the app went to the background, each save could fail with "File picking is already in progress" until you closed the app.
- You can now save an ElevenLabs key on a free plan when your ElevenLabs account has Voice Library voices. When you set up the key, the app selects the built-in voice Alice, as the desktop app does. When you replace a key, the app keeps the voice that you chose. You can choose a different voice at any time.
- When live voice cannot start on the server, or stops with a reason, an alert now shows the full message, not only "Request failed.". It tells you to update Codex and sign in with ChatGPT on that computer. A server on the new version also gives the reason. The voice bar keeps a short status.
- The steps to connect your computer now name the buttons that OpenBot on the computer shows: Add phone, then
  Yes, sign in. Before, they named a Generate QR code button that no longer exists. When your account has no
  servers, the phone now tells you to turn on Publish this server on your computer.
- A page from an agent that is too tall for its card in the chat now shows "Tap to see all" at the bottom
  of the card. Before, the card cut the page and did not show that there was more.
- Long channels with many agents no longer stutter and use less data. Before, each update of a
  channel sent all its earlier tasks to the phone again. The server must also be on the new version.
- Changing only the model of an agent now saves when another provider lists a model with the same name. Before, the app showed "Request failed" and did not save the model. The server must also be on the new OpenBot version.
- In your own message, a pair of `*` that touches a letter or a number now shows as you typed it, as
  in the chat list. For example, `100*200*300mm` no longer shows as `100200300mm` with italic text.
  `*text*` with spaces around it is still italic, and agent replies do not change.
- In a right-to-left chat, such as Arabic, inline code now keeps its left-to-right order. Before,
  `0.41` showed as `41.0` and `RTX 3060` showed as `3060RTX`.
- Show only models that can take dictation in the Dictation list of a voice server. Before, the list
  also showed OpenAI realtime models such as `gpt-live-transcribe`, and dictation with them stopped
  with "HTTP 404". When a voice server cannot transcribe with the chosen model, the message now tells
  you to choose a different dictation model.
- When you tap "Waiting for you in" a group chat in an agent's chat, the group chat now opens at the
  question card of that agent, and the card is highlighted. Before, it opened at the newest messages,
  and you had to scroll to find the card.
- A chat file that you share from the phone app keeps its own name in the app that gets it. Before,
  the name started with a long number, for example `1794743792117-backup.jwlibrary`, and some apps
  did not open the file.
- Dictation with a speech model on the phone (Parakeet or Qwen3-ASR) now hears you from the moment you
  tap the microphone. Before, the first words were lost while the model loaded. When the model is not
  loaded yet, the text can come a few seconds later.
- When two of your servers have an agent with the same ID, for example after you copied a server, the
  app now opens the chat of the agent that you tapped. Before, it could open the agent of the other
  server, and your messages went to that server.
- A question card that asks you to fill in a field now shows the question of the agent above the field. Before, the card showed only the field name, such as "Website", so you could not tell what to type.
- A large photo or file on a very slow connection no longer stops after one minute while it still uploads. Before, a file of more than 4 MB stopped when the connection sent less than about 50 KB each second, and the message showed "Not sent". Now the upload continues while data moves, and it stops only when no data moves for one minute.
- A personal WhatsApp number no longer shows "This message was deleted" in a contact's chat or in a
  group when the agent does not answer there. OpenBot no longer posts the "Working on it…" or waiting
  message in those chats, and the description of the "“Working on it…” message" switch now says so.
  The server must also be on the new version.
- Show the app connect card in your chat when an agent asks a teammate to connect an app. Before, the
  card went to the teammate's chat, and the agent said that the card was in your chat. The server
  must be on the new OpenBot version.
- On Home with a backdrop, the ring around the badge of a pinned agent or channel shows the backdrop.
  Before, it was a solid dark circle.
- On Android, the Sort menu of the chat list shows all its orders again: "Manual", "Recent activity" and the two unread orders. Before, it showed only "Manual".
- You can type and paste in the private field when an agent asks for an API key or a password, also
  while the app reconnects to your server. The send button starts to work when the server is online
  again. Before, the field removed each character that you typed during a reconnect, for example
  just after you came back to the app, and the only option was Skip.
- The home screen now shows your agents when the app opens on a chat, for example from a
  notification, and you go back. Before, the home screen could show the search bar and no agents
  until you force-stopped the app.
- A message to a Hermes agent no longer fails at random with "Internal error: revision_conflict". The message now starts by itself a short time later, so you do not have to send it again. The server must be on the new version.
- A chat video now starts to download sooner. When a waiting download of a picture or a video is no longer in a chat that you see, for example after you leave the chat or scroll far away from it, the app skips that download.
- While a chat video waits to download, its card shows a spinner. Before, it showed a Play button that did nothing.
- When the model service of an OpenCode agent fails in a way that OpenCode does not know, the chat now says that the model provider failed and tells you to try again later or choose another model. Before, the chat showed only the provider's technical error text. The server must also be on the new OpenBot version.
- Show workflow notifications on the phone. A "Notification" output and a step that waits for
  approval now send a notification, and a tap opens that workflow. Before, no
  notification came. The server must also be on the new version.
- While the app is open, it now gets the new messages of a chat when an agent finishes an answer
  there, also when the chat is not open. When you then open the chat, the answer shows without a wait,
  also on a slow connection to a server. Before, the chat showed the old messages for some seconds.
- A long answer from a Pi agent with an html card, or with much CSS or JSON, now shows complete in the
  phone app, and its preview is no longer blank. Before, the answer stopped after about 1.5 KB with
  `[redacted-unscanned]`. The server must also be on the new version. Answers that were cut before
  stay cut.
- On iPhone, a voice model download in Settings > Voice continues when you go to a different app or
  lock the screen. Before, the download stopped and you had to start it again.
- An agent question now shows the text that the agent puts under the question, such as the commands to run or a link to open. Before, the question card showed only the question and the choices. The server must also be on the new version.
- When "Read aloud" cannot play a message because the voice model is not on the phone, the message
  now tells you to download the voice model in Settings > Voice. Before, it told you to choose a
  voice, also when a voice was already selected. The message also has a "Voice settings" button that
  opens that screen.
- The computer that the phone app is paired to shows the plush server logo when it has no logo, as
  on desktop. Before, it showed the old monitor tile.
- On iPhone, the app now connects to your server again by itself after a short loss of network while it was in the background. Before, in some cases every try failed with "The desktop did not connect.", and only closing and opening the app again helped.
- When iOS cannot load a photo that you pick for a chat, the app now tells you to open the photo in
  the Photos app until it shows fully and to try again. Before, the app showed a technical error,
  for example "Cannot load representation of type public.png".
- In the phone app, you can change an agent to a second provider account and a model that only that
  account has, in one save. Before, the save failed with "The selected agent model ... is unavailable:
  ... does not list it".
- Read aloud and the spoken reply in a voice conversation no longer say list marks, such as "-", "+", "*" or "•", before the points of a nested list. They also no longer say task boxes such as "[ ]", the ">" of a quote, or lines of "=" under a title. You hear only the words.
- The page of an MCP server in Marketplace > Apps now always shows Sign in when you are not signed in.
  Before, it showed only after the agent asked for a sign-in, so you could not sign in to a server that
  shows its tools without a sign-in.
- When you tap a one-time routine in the server schedule, the phone app now opens it. Before, the app
  said "This routine is no longer available.", although the routine was still active. You can change
  its date, time, name and instructions, pause it, test it and delete it. The server must have a
  version that shows one-time routines in the schedule.
- The queue of an agent now shows a routine run by its routine name. Before, it showed the full routine instructions, and for a webhook run also the raw event data.
- An answered, cancelled or waiting confirm card in the chat now uses the full card width. Long field values no longer wrap one word on each line or go over the next message.
- A failed task card that you swipe away on the iPhone Lock Screen no longer comes back. Before, the app showed the same failure again when it opened. Now the swiped failure stays hidden, also after the app restarts, and the phone marks it as seen on the computer, so the computer's Dynamic Island and other phones stop showing it too. A new failure shows a new card.
- The Send Message shortcut and the Action button now send the message while OpenBot is open. Before,
  the app showed "Reconnecting" and the message did not go. This fix needs the new app version from the
  App Store.

## [1.4.13] - 2026-11-24

### Added

- The list of hosted servers shows "Restoring data" while a renewed server gets its data back from
  its archive, and shows until which date the data of a server with an ended plan is kept.
- Give a server to another OpenBot account from Server settings › People › Transfer ownership. The
  new owner gets an email and a message in the app, and accepts or declines it. The previous owner
  loses access; agents, routines and data stay on the server. Only a server that you run yourself
  can change its owner, not a server that OpenBot hosts.
- Settings > Account > Invite friends shows your invite link as a ticket. Tear the stub along the
  line to send the link, or copy it with the button at the top. A friend who joins with it gets
  10% off their plan, and you get 10% of each of their payments as credit.
- iPhone: In the List Agents shortcut, each agent has a message button. It sends a message to that
  agent, and the app does not open.
- Add the "Neon coast" chat backdrop, with a police chase, a crash and a fireworks yacht on a
  sunset coast, in Settings > Appearance > Backdrop.
- Server settings > Providers has an "Update all" action. It shows when one or more providers on the
  server have an update, and it starts all of them at once.
- Refresh the agents, chats and channels in the background, so the app shows current data when you
  open it. The app is now in iOS Settings > General > Background App Refresh. iOS and Android decide
  when a refresh runs, and they refresh only an app that is still in memory. Before, the app read its
  servers again only when you opened it.
- Choose the ChatGPT account that GPT live voice uses. In Settings → Voice → GPT live voice, a
  server with more than one Codex account shows an account choice. The server must be on the new
  version.
- Agent settings › Advanced has an "OpenBot memory" switch for owners and admins. Turn it off to let
  an agent use only a memory app, such as Mem0. Saved memories stay. The server must be on the new
  version.
- An owner or an admin can add up to 8 folders to a channel. All agents in the channel can then change files and run commands in these folders. The server must also be on the new version.
- Agent pictures have three new shapes: a ghost, a jellyfish and an octopus, in the plush and the flat style. Select them when you edit the picture of an agent.
- The Claude and Pi pages of a server have a "Compact before the cache expires" switch. When it is on,
  an idle chat with a long context compacts itself before its 1 hour prompt cache expires. The server
  must be on the new version.
- An owner or an admin can choose, download and remove the speech recognition model of a server in
  Server settings > Agents > Speech recognition. Agents on the server use it to transcribe the sound
  of videos that have no captions. The server must be on the new version.
- You can pause and resume a workflow. Open the workflow, open its menu and select Pause or Resume. The
  workflow list shows "Paused" for a paused workflow. The server must be on the new version of
  OpenBot.
- When an agent needs to know where you are, such as for "restaurants near me", it asks with a card in
  the chat. Tap **Share once** to send this phone's current location one time, **Always allow** to
  let that agent get it without asking while you use the app and the request is yours, or **Don't share**. The app reads the
  location only while you use it. The server must also be on the latest OpenBot version.
- Server settings shows the Signal server row to each member, with the latency of the Signal server
  that the server uses, in green, yellow or red. An owner or an admin opens the row to choose a Signal
  server; the list shows the colored latency of each one, and "Automatic" keeps the nearest one. The
  server must also be on the new version.
- Settings > Credits shows your OpenBot credits, the credits of your servers, and the recent credit activity. You add credits in OpenBot on your computer.
- In the workflow editor, you can add Image, Video and Asset nodes and change them on the phone. An Asset node uses a picture from the server library or a photo that you upload. For a model that uses credits, the Image and Video nodes show the price per run, and they tell you when you do not have enough credits. The workflow page shows the price as a badge on each node, and the total price per run under the workflow name.
- You can connect Gemini on a joined server from your phone. The server shows a Google link; open it, then paste the code or the address of the page where you land. The server must have the new version.
- You can make an allowed WhatsApp contact or group read only in Marketplace › Apps › WhatsApp: tap the
  chat, then **Make read only**. OpenBot saves its messages for your agents and never writes in it.
  The server must also be on the new version.

### Changed

- Android: Google Play now lets you install the app on devices that do not have Wi-Fi or a portrait
  screen, such as some tablets, Chromebooks and Android XR headsets.
- The support log shows when the phone uses a proxy app such as Clash, and it shows a TCP or TLS
  relay path as TCP or TLS, not as UDP.
- The app is faster when a server has many agents. The home list keeps fewer rows ready, an idle
  agent picture uses less power, and search does less work while you type.
- A chat does less work while an agent replies, and other agents no longer slow down the open chat.
- A chat with unread messages opens at once when the phone already has them.
- Updates from the server come to the app in groups, so many agents that work at the same time do
  not slow it down. When the app comes back, it loads again only the chats that missed an update.
- The home screen does not show the large server name above the agents. To open the server list,
  use the server button in the header.
- The prompt cache setting of a server is now also on the Pi page, because the "1 hour" choice now also
  applies to Pi agents. The other choice is now called "Provider default". The server must be on the
  new version.
- The "Add a node" sheet of the workflow editor shows the nodes in the groups Inputs, Steps and Flow, as on the computer.
- A workflow Image or Video step whose OpenBot credits model is not available now shows the name of
  that model with "not available". The server must also be on the new version.
- The server drawer shows your credits above your name. A bar shows your credits and the credits of the open server. Tap it to see all your credits, the credits of each server and the credit activity.
- The server drawer has aligned edges: the server list and your name line up with the tools, and the buttons line up with the tool values.
- The Credits screen shows your credits as a large number at the top, with the credits that expire next. Servers with no credits are in one row that you can open. The activity is grouped by day. When you have no activity, the screen tells you how credits work.
- On the Credits screen, tap a server that you own to move credits between your credits and that server, in either direction.
- When you move credits, stars fly from one wallet to the other, and the receiving wallet reacts to each one.
- After a move, the changed balances on the Credits screen turn pink and count to their new values.
- On the Credits screen, the last 3 activity entries show under Recent activity. See all activity opens the recent history by day. When the list covers the last 7 days, it also shows the credits used and the moves in that time.
- In the server drawer, the button next to the server name opens Server settings. To add or join a server, open the server list and tap the last row.
- In the server drawer, tap your name to open Settings. The gear next to the server name opens Server settings.
- The Cloud server sheet now shows the steps to add a cloud server on your computer first. The plans
  are in a "What each plan includes" section that you open, and they no longer look like rows that
  you can tap.

### Fixed

- iPad: The mouse wheel scrolls the agent list. To pin an agent with a mouse or trackpad, open
  its menu.
- A message that was sending when you left the app no longer stays "Not sent" and holds all later
  messages of that chat. The app sends it again when you come back.
- When an agent asks you to sign in to an MCP server, the chat now shows a Sign in card. The page of
  an MCP server in Apps now has a Sign in button when the server asks for a sign-in, so you can
  finish the sign-in on your phone.
- Plan limits now show each Gemini (Antigravity) model pool on its own line, such as the pool for
  Claude and GPT models, as on the desktop. The server must also be on the new version.
- In chat, you can tap a phone number or a `tel:` link to open the dialer. Before, nothing happened (#13211).
- When you change the browser profile of an agent, the app now tells you that site sign-ins stay in the old profile. The agent must sign in to these sites again.
- On smaller iPhones, the provider usage rings show again in the home header, and the `…` menu
  opens directly, not through an extra overflow button.
- An agent chat now shows "<provider> is not signed in" with a Sign in link when the agent's provider
  needs sign-in, if you can manage the server's providers. The link opens the provider in Server
  settings > Providers. The queue also says "Waiting for <provider> sign-in" when queued work waits
  for that sign-in, and a side thread or routine task says "Waiting. The provider of this agent needs
  sign-in.", if the server is on the new version.
- Tell why an OpenRouter model search finds nothing. OpenRouter lists only the models that the
  privacy, provider and guardrail settings of your account on openrouter.ai allow. Before, the
  Model page showed only "No models match your search".
- Usage now shows the provider that you selected, for example DeepSeek or ChatGPT, and not the program that runs it, for example Pi CLI. A model that has no price shows "No cost estimate" and not "Unavailable".
- You can sign in to Devin on a server from its Providers page. Before, the page had no sign-in for
  Devin. The server must run Linux and be on the new OpenBot version.
- Messages from the channel Coordinator now show in your interface language, in the chat and the
  channel list. Before, they always showed in English.
- You can now answer a question card that stays open after the agent ends its turn. Before, the app showed "Couldn't send your answers" each time you sent the answer.
- When you change the text of a draft on a confirm card and the card closes before you choose an action, your changed text goes back into the message box.
- Choose more than one answer when an agent asks a question that takes more than one, then tap
  Done. Before, the first tap sent only that one answer.
- A chat file from 10 MB to 100 MB, such as an Android app (APK) or a long video, now opens, plays, saves and shares on Android phones. Before, the app could show "errno/ERR_UNEXPECTED" and the file did not open. The app now saves the file on the phone part by part while it downloads, so it uses much less memory.
- When a site refuses a sign-in from a server, the sign-in card no longer shows **Open**. Before, **Open** showed the server's page, and a site such as Instagram showed only a blank white page there. The card still tells you to sign in from the OpenBot desktop app on your computer.
- A large attachment on a slow connection no longer stops at the same point with "The attachment upload timed out." Before, a file of about 14 MB on an upload of less than about 2 Mbit/s stopped after one minute, and each retry stopped again. Now the upload continues while the server reports that it receives the file, and it stops only when the server reports no progress for one minute.
- On Android, a file that the app could not read was sent to the agent as a 14-byte "File not found" file, with no error. The app now shows "The attachment is unavailable. Try again." and does not send the file.
- A custom provider now accepts a model ID that has `@` or other punctuation, such as the
  `@cf/openai/gpt-oss-120b` models of Cloudflare Workers AI. Before, the form refused these IDs. The
  server must also be on the new desktop version.
- A workflow agent step now shows "Queued" while its message waits for the agent to take it. Before, the step showed "Running" the whole time. The server must also be on the new version.
- The Muse provider in Server settings > Providers now says that Muse uses a saved Meta API key, not
  the sign-in, if the server has a saved key.
- An OpenCode agent that cannot take a message into its running turn no longer shows Steer. Before, each steer failed and the message waited in the queue.
- In a channel, the "new messages" line no longer moves up by one message when an agent shows you a setting. The phone does not show setting cards, so it does not count them as new messages.
- When **Personal number** is off for a WhatsApp number, the WhatsApp screen now says that your
  “Message yourself” chat still reaches OpenBot. Before, it said that only the people you allow can
  write.
- Datadog accounts on the EU site can now connect from Marketplace with the new Datadog EU app.
  Before, the Datadog app connected only to the US1 site.
- When you add or change an MCP server, the app does not let you save a header name that has a space
  or a symbol, such as `Authorization Bearer`. The headers text tells you to put the key or token in
  Value.
- In the Marketplace, an app that needs no sign-in and no key, such as Apple apps, now shows
  "Connected" only after its server starts on the computer and answers. When the server does not
  start, the app shows why and you can try again. Before, the app showed "Connected" also when its
  server could not start, and agents then could not use its tools.
- When a password or code card is sent after the agent stopped waiting for it, the card now says
  "This sign-in request has ended. Ask the agent to try again." It no longer tells you to check the
  connection.
- In "Waiting for replies", a failed request to a teammate now goes away when the agent asks that teammate again. Before, the failed rows stayed until you wrote a new message, also after a new request was successful.
- When a server member cannot update a server because remote updates are off, the message now tells
  the user of that computer where to turn them on: Settings > Updates > "Allow updates from server
  members".
- A model that an admin turns off in a provider's Models settings no longer shows in the model list of every
  agent when one agent still uses it. Only the agent that uses it keeps it. The server must also be on the
  new version.
- The free space in server storage and the disk in server usage show disk sizes as your computer and
  phone show them. Before, a 245 GB disk showed as 228.2 GB. The storage of a hosted server plan does
  not change.
- A Telegram, Slack or Discord step in a workflow that was moved to another computer or server showed
  "One chat", "One workspace" or "One server". Now it shows **Choose chat**, **Choose workspace** or
  **Choose server** until you choose one.
- The first tap on Send now sends the message while the keyboard is open. Before, the first tap
  only closed the keyboard sometimes, and you had to tap Send again.
- On iPhone, when you tap the message field while a chat is still opening, the keyboard now opens
  when the chat is open. Before, the keyboard did not open, and the field did not work until you
  left the chat and opened it again.
- An agent's question card now shows in the agent chat while the agent waits for your answer, also
  when the chat did not load fully. Before, the chat sometimes showed only "Waiting for your answer",
  and you could not see or answer the question on the phone.
- When you came back to a new workflow from a node sheet, the Name field took the focus again and opened the keyboard. Now the keyboard stays closed.
- A short visual from an agent, for example a folded card, no longer has a large empty area under it
  in the chat. The visual is now only as tall as its page. When "Show full visual previews" is off, a
  tall visual is still cut.

## [1.4.12] - 2026-11-20

### Added

- Settings › Appearance has a Backdrop section, as the desktop app has. Select a scene (Koi pond,
  Jellyfish, Old-style sunset, Snowfall or Fireflies) or a photo. The scene shows behind your chats
  and behind the top of Home, where the chat list is a card under the pinned agents. A Calm–Vivid
  slider sets how much of the scene shows.
- When an agent sets a backdrop with `set_backdrop` in the open chat, the phone shows it too. Undo in
  the chat puts the old backdrop back.
- Message color has a Bubble style: Solid fills your bubbles with the color, Tint mixes a part of the
  color into the bubble.
- The sidebar has a Providers row for an owner or admin of a server, as on the desktop. It starts
  unpinned: pin it with Edit sidebar.
- The iPhone app has a new Open Agent shortcut. It opens the chat of the agent that you chose in
  Settings > Shortcuts. You can put it on the Home Screen or on the Action button. It needs iOS 26
  or later.
- When OpenBot on a server cannot start, the app now shows why, with the version of the server.
  Before, the app could not connect and did not show a reason. This needs a server with the OpenBot
  release that adds this.
- An agent can now get the signing secret of its webhook routine, so you do not have to copy it.
  In the routine of an agent, tap the agent button next to the signing secret. The agent gets a new
  secret as its own API key and can add it to the sender. The old secret stops working. The server
  must also be on the new version.
- Side questions in an agent's chat. Tap More > Side question, or swipe away from Back over the chat, to
  ask the agent about the chat without adding to it. You can dictate the question. Back keeps the side
  question on this phone so you can open it again; the trash button in its header deletes it. The
  server must also be on a version with side questions.
- The email sign-in has an optional field for a friend's invite link or code. It counts only when that
  sign-in creates a new account. The friend then gets 10% off each payment.

### Changed

- The description of the WhatsApp "“Working on it…” message" switch now says that the switch also
  turns off the waiting message.
- When your app is older than the oldest version that OpenBot supports, it shows **Update required**
  with a link to the App Store or Google Play. OpenBot supports at least the app versions of the last
  2 months. An app that is offline or cannot reach the account service is never blocked.
- While agents write, the app reads the unread counts from the server at most once a second. Before,
  each streamed piece of text started a new read, and a server with many agents used much CPU on it.
- Settings › Appearance is shorter: a live preview of a chat, then four tabs (Theme, Colors, Backdrop
  and Chat) with the settings of each topic.
- Chat bubbles are now solid, so a backdrop does not show through them. To get the old see-through
  bubbles over a backdrop, turn on See-through bubbles in Settings › Appearance › Backdrop.
- Server settings > Transfer > Copy to another server now also copies the workflows and routine flows
  of the agents that you copy, with the places of the routines on their canvas. Before, only the
  agents with their routines arrived, and you had to make the workflows and flows again. MCP servers,
  model providers, sidebar sections and shared skills still stay on the first server.
- A change of server in the drawer is smooth. The drawer closes first, then the pinned agents come in
  from left to right and the list comes in from top to bottom. Before, the new list loaded while the
  drawer closed, and the motion stopped for a moment.
- With a backdrop, the card under the Home list keeps its round corners and moves smoothly to its new
  place when you change servers. When you pull the list down, the backdrop stretches with it, so the
  server name and the pinned agents stay on the backdrop.
- When you scroll to the top of a chat, a small spinner shows while older messages load. The
  "Load older messages" button is gone, and the messages no longer move when the load starts or stops.
- The preview of a text or Markdown file shows the whole file. Before, it stopped after 200,000
  characters. The Markdown view loads the next part as you scroll, and the code view shows a long
  file in parts, with buttons to go to the previous or next part.
- In the preview of a Markdown file, a code block of more than 25 lines scrolls inside its box.
- On iPhone, a pull up at the end of a chat now starts the ring after the same finger travel as on Android.
- While the reply to your latest message is short, the chat shows only the end of a long message,
  such as pasted text, under the header. The reply then starts on the screen. A message with images
  is not cut.
- The swipe away from Back in an agent's chat now opens the side question by default. To change it, go
  to Settings > Conversations. A swipe that you chose before stays.
- The support log now records each STUN or TURN server that the connection to a server cannot use,
  with its error code. Support can then find a VPN, DNS or blocked port that stops the phone from
  connecting. The log never names the addresses of the phone.
- In a chat, the rows that show messages between agents ("Messaged", "Informed", "Assigned to") are
  now on the left, with an icon, in the same style as the routine and memory rows.
- The agent name in the chat header is now in the center, with no arrow. A second line under the
  name shows the open thread, the number of unread threads, or the number of threads. Tap the name
  to open the thread menu. A thread and a side question show the agent name with the thread or side
  question name under it.
- The Vault login form and the password import of a server no longer say that a website must be
  HTTPS. A server on the new version also saves `http://` logins.
- "New chat" now says that the agent can still look up the earlier messages. A server on the new
  version lets the agent find them.

### Fixed

- The app connects again to a server on OpenBot v0.34.1 or older. Before, the first request sent too
  many feature names for these servers: a server on v0.20 to v0.34.1 refused each request over a
  direct connection, and an older server ignored the features that the app asked for.
- The app compares the protocols of a server with the protocols that it speaks. A server that stops
  support for old protocols stays available. A server that is too old now tells you to update OpenBot
  on the server, not the app.
- The server schedule now shows one-time routines, as the desktop app and the web client do.
- The back button of a chat, a channel or a thread closes it again. Before, sometimes it did nothing
  until the chat opened again, for example after a sheet or the browser closed. The swipe back worked.
- When the browser gives control back to the agent after the browser closed, the chat under it stays
  open.
- A short bug report or idea card in a chat no longer has an empty area that pushes Send and Not now down under the message box.
- When a new thread did not start because the answer from the server got lost, a second try no longer
  makes a second thread with the same first message. The server must also be on the new version.
- When the answer to a new agent got lost, a second try no longer makes a second agent or sends the
  first message two times. The server must also be on the new version.
- When you send a message in a thread again after a failed send, the server no longer stores it two
  times.
- The app is faster while an agent replies. Before, the open chat did its work again for each frame
  of a reply, and each message to an agent made all messages in the chat show again.
- An open chat uses less battery. Before, it animated a hidden agent face all the time.
- Home, the chat list and the agent faces use less power while agents work. Before, each row read
  the same agent state three times, and each moving face made new drawing objects for each frame.
- The Threads page scrolls smoothly with many threads. Before, it drew all threads at once.
- Headers and sheet edges use less power while you scroll. They now use fewer blur layers.
- A channel reply updates with less work. Before, a change in a channel also showed the other open
  channels of the server again.
- A screen that you open from the side menu shows when the menu has closed. Before, it waited a fixed
  time.
- The app starts and goes to the background with less work. It reads the saved data of the active
  server first, and it does not save a server again when nothing changed.
- The iPhone app does not stop when a screen header adds or removes a button during a layout.
- On iOS 18, the app does not stop when you type fast in a text field of a form.
- The iPhone app does not stop after some time with the live view of the browser or a moving chat
  backdrop. Before, each picture stayed in memory until the app ran out of space for its animations.
- A link to a file in an agent's message, such as `[file](/path/report.md)`, is a file chip that
  opens the file, as on desktop. Before, the link was plain text that did nothing. A file that the
  message attaches and also links shows only as the chip, not again as a card above the message.
- A large Markdown file with long code blocks, such as a crash report with stack traces, opens in the
  preview. Before, the app closed when it opened the file.
- On Android, the first tap on an option in the + menu of the chat composer now runs that option.
  Before, the first tap after the menu opened did nothing.
- After a theme change, the folder headers and the Unread header on Home use the new colors. Before,
  they kept the old color until the app restarted.
- A chat under another full screen, such as a subagent, no longer renders each chunk of a reply. It
  shows the latest reply when you go back to it.
- Replies in Portuguese are read aloud with the Portuguese voice. Before, a short reply with
  "você", "faça", "três" or "às" was read with the French voice.
- A chat link to a file in the Shared folder of a server opens when the agent writes a space or another
  character in the path as `%20` or a similar code. Before, the app said that the file did not exist.
- The "Add a group" screen for WhatsApp now tells you that people in the group must mention the
  linked number or reply to its messages to give work to your agents.
- When Proton refuses the Proton Pass connection because of the plan, the app now says that it needs a
  Proton plan that includes Pass Plus, and that other paid plans such as Mail Plus do not include it.
  Before, it said that a paid plan was missing.
- A display formula in a chat reply that comes directly after a line of text shows as a formula
  when one of its lines has only `=` or `-`. Before, it showed as LaTeX source with plain square
  brackets, and the text above it became a large heading.
- When a turn in a thread fails, the notice now explains the failure in plain words, as a failed
  chat message does. Before, the notice showed the raw provider error, such as JSON or a stack trace.
- A question card that stays open after the agent continues, such as with Gemini (Antigravity) after
  3 minutes, can now be answered in the app. Before, it showed "Form expired" when the agent's turn
  ended, but the agent still waited for the answer.
- When you import a transfer file or copy agents to another server, the app now asks before it adds
  an agent whose name is already on the server. Before, a "Name already used" note was the only sign,
  so the import could add many duplicate agents without a warning.
- A routine in a channel shows as one routine line, with its state, as in an agent chat. Before, each
  run showed the full routine instruction as a message, and a webhook routine also showed the raw
  event data.
- On a server that has WhatsApp, "Send answers to" of a routine also lists the WhatsApp chats. The
  server must also be on the new version.
- On Android, the app starts after an interrupted over-the-air update. Before, a partly downloaded
  update file could stop the app at launch.
- Over-the-air updates use less memory while they download.
- Typing in a thread with many messages is smoother. Before, each key drew the whole message list
  again, and the chat above the composer could stop for a moment on Android.
- Tell the user to turn off Lockdown Mode for OpenBot when the phone cannot connect to a server
  because of it. Before, the app showed only a technical error and tried again with no result.
- When a provider on your server waits to update or restart until its running tasks end, the message queue of each agent on that provider now says so. Before, the queued messages waited with no reason. The server must have the desktop version with this fix.
- With solid message bubbles, question, approval, vault request and app suggestion cards are now
  solid too. The chat background no longer shows through them.
- A question from an agent with more than one part now shows its full text. Before, the text showed in a narrow column of a few letters.
- When you answer the welcome question of a new agent, your answer shows in the chat as your own
  message, under the question, not above it. The server must also be on the new version.
- Every member of a server can now add a login, a card, contact info or an API key when an agent asks for one, not only an owner or an admin. The server must also be on the newest version.
- When you add an ACP agent to a server, the preset list no longer has GitHub Copilot. GitHub
  Copilot is a provider, and you connect it in the server provider settings.
- The Android app does not stop when a chat updates its message list. Before, a view that React
  Native made early could be removed twice.
- The Android app does not stop when Android starts it again while a sheet is open.
- The Android app does not stop when it closes before it is fully started.
- On Android 17 Pixel phones, the app does not freeze when a long chat opens. The app now turns off
  Content Capture, so the system does not read the text of each screen.
- The Android app does not freeze when a chat shows a large SVG image. The app now draws the SVG
  once in the background.
- The Android app does not freeze when it returns to the foreground on a slow phone. It no longer asks
  Google Play for the install referrer, which it did not send.

### Security

- The phone now deletes the agent and channel pictures when the session expires, not only at sign-out. When the app starts with no valid session, it also deletes the saved copy of your servers that a stopped sign-out left.

## [1.4.11] - 2026-11-18 (Android), 2026-11-19 (iOS)

### Added

- Connect AppSignal from the Apps marketplace with browser sign-in, so agents can search errors,
  find slow actions, and read logs, metrics and uptime monitors.
- Connect Cloud 66 from the Apps marketplace with browser sign-in, so agents can see applications
  and servers, read deployment logs, and start deployments.
- Owners and admins can choose the shape and color of the felt plush that a server shows when it has
  no logo, in Server Settings. The server must be on the new desktop version.
- Show a pace mark on each plan limit bar. The mark is the amount that is left when you use the
  limit at an even rate until its reset. A bar that ends before the mark runs out before the reset.
- Press and hold the mic or the waveform button in a chat to open the voice settings. Closes #9374.
- A context ring in the chat composer shows how full the agent's context is, as on the desktop. It
  appears when you open the composer. Tap it to see what fills the context, to compact it now (also
  in a side thread), or to start a new chat. A server that does not report context usage shows no ring.
- Add the "Show full visual previews" switch to Settings > Appearance. When it is on, a visual from
  an agent shows at its full height in the chat. It is off by default: a tall visual stays cut, and
  a tap opens all of it (#9594, #8874).
- Show the subagents that an agent starts as one line, as on desktop: their count, progress and
  time. Tap it to open a sheet with each subagent and its latest step or answer, then tap a
  subagent to see its task, steps and error.
- Show the memory changes of a turn as one line, such as "Memory: 2 saved". Tap it to open a sheet
  with each memory that the agent saved, updated or forgot. The server must also be on the new
  version.
- Swipe left in an agent's chat (right in a right-to-left language) to open the agent's threads. In
  Settings > Conversations, you can set the swipe to open the agent's browser instead. A swipe on a
  message still replies to it, and Back from the opened screen returns to the chat.
- Pull up past the latest message in a chat to open its info: the agent info in an agent's chat or
  thread, and the channel info in a channel. A ring around the picture fills as you pull; release
  when it is full. You can turn this off in Settings > Conversations.
- In Server settings > Vault, choose the agents that can use each login, card, contact and API key,
  as on the desktop. The Vault list shows the agents of an item that is not for all agents. The
  server must be on OpenBot 0.70.0 or later.
- A queued message to an agent that cannot steer its running turn now shows **Send now**, as on
  desktop. Send now moves the message to the start of the queue and stops the agent, so the agent
  reads the message next.
- Send a bug report about the phone app with the data that the OpenBot team needs. When an agent offers such a report, the card shows what the phone adds: the app version, your system and device, your kind of network with the name of the VPN or mesh network that is on (such as Tailscale), and the last warnings, errors and connection events of the support log. The log lines have no server ID, network address, host name of your server or record ID: the app masks them, and it leaves out console lines. Before, the report had only the data of the computer or server. The server must run the newest OpenBot version.
- Sort the chat list by "Recent activity": each folder shows its most recent chat first. Pins and
  "Needs you" stay on top, and your manual order does not change. Choose it in "Sort chats".
- An owner or admin can set the environment variables of Claude, ChatGPT (Codex) and Gemini in Server
  settings > Providers > a provider > Variables, for example to send their requests to a proxy such as
  CLIProxyAPI. A sensitive value stays on the server. The server must also be on the new version.
- Choose a chat background in Settings > Appearance. Light and Dark each keep their own color, and a
  color that makes text hard to read becomes darker or lighter.
- You can turn off the status reactions (👀, ✅) of a WhatsApp number in Marketplace › Apps › WhatsApp.
  The server must also be on the new version.
- Hide details of agent replies in Settings > Appearance. **Show agent thinking** hides the steps row
  above replies and the agent's reasoning while it works. **Show subagents** and **Show saved
  memories** hide the subagents row and the saved memories row. The agent still reasons, runs
  subagents and saves memories.
- In Server Settings > Providers, you can now add a ChatGPT (Codex), Grok or Claude account with a
  code: select "Add account with code" under "Add account". The server starts the sign-in, and
  "Open sign-in page" opens the provider's page on the phone. A signed-out account has "Log in with
  code" on its page. Claude has it only when the server runs on Linux. The server must be on the
  version that added the code sign-in on desktop.
- Delete the history of an agent's chat in the agent's Advanced settings, as on the desktop. You see
  it when you can manage the agent.
- Start a new conversation in a channel, compact the channel context, and delete the channel history
  in the channel settings, as on the desktop. Only owners and admins can delete the history. The
  server must run an OpenBot version that has these actions on the desktop.
- Swipe left on a message to move the chat and show the time of each message, as in Messages on
  iPhone. The times hide when you let go.
- Turn off the swipe that opens threads or the browser in an agent's chat, in Settings >
  Conversations.
- Drag the screenshot preview, or photos, videos and files from another app, onto a chat to attach
  them. Before, you had to copy the screenshot and paste it.
- The workflow editor has a Flow view. It shows the trigger and the steps as a flow from left to right,
  as on the computer, with the yes and no paths of a condition one under the other. Tap "+" between
  two steps to add a step there. Touch and hold a step to move, duplicate or delete it. The List view
  stays available.
- The workflow page can show the steps as a flow, also for a workflow with many conditions or a loop.
  Choose Flow or List in the "…" menu. The flow is a canvas from left to right: the paths of each
  condition sit one under the other, and the canvas scrolls sideways.
- The editor has the Flow view for every workflow, also for a workflow with many conditions or a loop.
  Tap + on a connection or at the end of a path to add a step there. In the List view, tap + on a step
  to add a step after it.
- The run page follows the Flow or List choice. In Flow, the run moves on the canvas as on the
  computer: a bright arc goes round the step that runs, a step that waits for you has an orange ring,
  the line into the running step moves, and the path that a condition did not take is dimmed. Tap a
  step to see its output and to approve, retry or stop it.
- You can set the system prompt of a model step, as on the computer.
- A GitHub trigger can listen to more than one repository. Tap a repository to add it to the list or
  remove it.
- Run a queued message in a new thread, as on desktop: tap the branch button on the queued message
  bar, or choose "Run in new thread" in the message options. The message leaves the queue, starts
  in a new thread beside the chat, and the thread opens.
- After you use OpenBot on several days, home asks once for a rating. The lilac header reacts to
  each star. For any rating, you can rate OpenBot on the App Store or Google Play, or open X with a
  post to the maker that you can edit. "Not now" asks again after 60 days, and an answer ends the
  asks.
- Choose the actions of the app icon menu in Settings > App icon menu. By default the menu shows your
  latest chat, Schedule, Search and "Wait, don't delete me!", which opens Support. You can also add
  Share OpenBot and your second latest chat.

### Changed

- A build without voice support, such as Expo Go, shows the mic and the waveform button in the
  chat composer too. A tap opens the voice settings, which say that voice is not available.
- A thread with unread messages now opens at the top of the NEW section and shows the NEW line, as an agent chat does.
- Show how much of a chat video has downloaded. While the video downloads, its card shows the
  percentage in place of the play button, the amount in megabytes, and a line that fills along the
  edge of the card. Older servers show it too.
- Copy, Share and Save in the message sheet are unavailable for a file that is still downloading.
  They become available when the download ends.
- A visual in the chat now has rounded bottom corners, so a cut visual does not end with a straight edge.
- The context ring moves from the composer into the + menu, so the composer keeps four controls. A
  dot on the + shows when the context is almost full.
- The + menu and the camera open above the composer and line up with its edges, so the draft and
  Send stay in view.
- A thread that you open from an agent's thread list now takes the place of the list, so Back returns
  to the agent's chat.
- On Android, the search fields and the round bar buttons have the plain fill of the chat composer.
  The home search field no longer blurs the list under it, and the buttons lose their grey edge and
  shine.
- On Android, the settings button at the bottom of the sidebar has the same round fill as the "+"
  button at the top.
- The support log now also has the screens that you open (by name only), each step of the notification setup, the notification, microphone and camera permissions, the free storage range and low memory warnings. This helps the OpenBot team find the cause of a problem such as missing notifications.
- "Report a problem on GitHub" in Settings > Support opens the form for the phone app with your app version and device filled in.
- You can now attach files of up to 100 MB in a chat, as on desktop. Before, the phone refused files
  larger than 10 MB. A file larger than 10 MB goes to the server in parts, so it does not fill the
  phone's memory. Pasted files and files from the iPhone share sheet stay at 10 MB.
- Settings is shorter. The chat settings (hidden chats, the swipe in an agent chat, pull up for info,
  large files and full-quality photos) move from the main Settings page to the new Settings >
  Conversations page. Search also finds this page.
- The "Compact message field" setting moves from Settings > Animations to Settings > Conversations.
  Your choice stays. When motion is reduced, the page tells you why the setting is off.
- The main Settings page groups its rows: look and feel, chat and voice, and privacy and security.
- Some settings are now pictures that you tap: Full motion or Reduced in Animations, the theme and
  the message color in Appearance, and the message field and the swipe in an agent chat in
  Conversations. A tap selects an option and plays a short demonstration of it. The pictures do not
  move when motion is reduced.
- All switches in the app now use the app's accent color, as the sliders and the selection checks
  do. Before, iPhone switches were green, and some Android switches (agent skills, a routine's
  "Enabled" and "All day") used the Material default colors.
- When you link a WhatsApp number to a server, the two number choices now say what other people get.
  On "My personal number", people you did not allow get no reply. On "A number only for OpenBot",
  OpenBot replies from the number to each unknown person with a code. The "Personal number" switch
  says the same.
- A server with no logo shows a felt plush squircle in its own colour instead of its initials, as on
  the desktop app.
- Routine, subagent, memory and thinking rows in a chat now have one design. They start at the left
  edge, with the same icon size and text size. A colored icon shows only while the work runs or
  after it fails. Memory changes have their own icon.
- The agent's Advanced settings show their options in three groups: Behavior, Workspace and Chat.
  Each explanation shows in its row, and the chat actions have icons.
- Compact context is no longer in the agent's Advanced settings. It stays in the context menu of the
  composer, as on the desktop.
- A swipe right on any message, yours or the agent's, replies to it.
- Turn off Delete for a channel while an agent works in it. Stop the work first, then delete the
  channel.
- Custom MCP servers moved from Server settings to the Marketplace, as on the desktop. Open
  Marketplace › Apps and tap Add custom to add one. Tap a custom server in Apps to change, test or
  remove it.
- The workflow editor opens as a page from the right, not as a sheet. Choose Flow or List in its "…"
  menu. Add a step opens as a sheet over the editor, and a kind of step that cannot go at that place
  shows as unavailable.
- The step list of a workflow with more than one condition or a loop shows the steps in the order that a
  run goes, with each path under its "If yes" or "If no" label. Before, it showed the steps in canvas
  order, from left to right.
- On the workflow page, Run and the "…" menu (Edit, Pin, layout) are in the header, in place of the
  Run now and Edit buttons.
- Steer (or Send now) is the first action on the queued message bar.

### Removed

- Remove MongoDB Atlas from the Marketplace. MongoDB lets only the AI clients that it registered
  sign in, and OpenBot is not one of them. Before, the MongoDB sign-in page said "This
  Authorization request is invalid", and the app never connected.

### Fixed

- Show why a channel request waits. Before, a request stayed queued with no reason when its agent
  worked in another channel, or when the channel already ran 2 tasks. Now the channel says which
  channel the agent works in, or that the agent starts when a running task ends. The server must be
  on the new desktop version.
- Show why a Discord server needs attention when it moved to another OpenBot server. The page now
  tells you to tap Reconnect to link it again. The server must be on the new desktop version.
- A WhatsApp number whose saved keys the server cannot read now shows Link again in place of
  Reconnect, which did nothing. The server must be on the new desktop version for Disconnect to
  remove the number.
- A chat file that you share or save to Files on an iPhone or iPad keeps its own name. Before, an
  HTML, CSV, code or other text file got `.txt` added to its name, for example `report.html.txt`,
  and other apps opened it as plain text.
- "Waiting for replies" no longer shows a teammate as working after it answered. Before, this
  occurred when the teammate finished after many new messages in the chat.
- A new HTML file that you attach, or a file that a message names, opens as a page in the file
  preview. Before, the preview showed only the HTML source.
- When OpenBot does not fill a saved login, the password or code card now says why, for example
  because the agent ran a script on the page or chose the wrong field. The server must also be on the
  new version.
- Connect HighLevel from the Apps marketplace with a Private Integration token and the location ID of your sub-account. Before, the browser sign-in always stopped on a HighLevel page with an "Invalid scope(s)" error, and the connection was not made.
- You can now connect Mistral on a server from the phone. Before, the Mistral provider had no Connect
  button. Now Connect gives you a Mistral page to open, and the server connects when you finish
  there. The server must also run the new OpenBot version.
- When a queued thread waits for a short time with no known reason, it no longer says "Waiting for a
  free thread". Before, it showed the thread limit also when none of the agent's threads ran.
- Dictation with the phone's speech recognition puts the text in the chat box once. Before, on an
  iPhone, the full text could appear a second time when you stopped dictation.
- On Android 9 and 10, the app lock no longer closes the app when it asks for the phone unlock.
- On Android, a chat with a long code block and the preview of a long code file no longer make the
  app stop responding. Above about 300 colored parts, Android shows the code in one color.
- On Android, the rail of the chat list, the server Library and the day strip of a routine no longer
  close the app when a row comes back into view.
- Connect Tessie from the Apps marketplace with an access token from Tessie's Developer Settings, and Omnisend with an Omnisend API key. Before, the browser sign-in of both apps always failed, because these services do not accept OpenBot for it.
- The app no longer closes at launch on early iOS 27 beta versions.
- Agent info > Advanced no longer says that a custom agent cannot steer when the agent reports
  that it can steer. The server must have the latest version.
- When the agent receives a queued message while you edit it, closing the edit screen now puts the
  text that you typed in the message box. Before, that text was lost.
- When a site such as X refuses a sign-in from the server, the browser card now says to sign in
  from the OpenBot desktop app on your computer. Before, it asked you to finish the step in the
  browser, and I'm done left the server browser signed out.
- Show the plan storage of a hosted server in the disk ring of the Usage screen. Before, the ring
  showed the whole disk of the server machine, which is much larger than the plan.
- The Model page of a Workspace only agent now tells you when the chosen provider does not work with
  Workspace only on the server. Before, you learned this only from an error when you saved. The
  server must also be on the newest OpenBot version.
- Steer is off for a queued message while the agent runs a routine. The message waits for the next
  turn. Before, Steer showed the error "A routine is running now".
- A task list that stopped now loses its "Stopped" title when the agent continues the work in a later
  turn. Before, the list kept "Stopped" and its old count after the work was done.
- Show the real size and shape of an image that an agent makes while the image loads. Before, the
  chat showed "1024 × 1024" and a square frame. The server must be on the new version.
- In the Marketplace, Apple apps now shows "Mac only" and cannot be added when the server is not a
  Mac. Before, it showed "No sign-in" and could be added, but it did not work there. The server must
  also be on the newest OpenBot version.
- After the Send Message shortcut or the share sheet sends a message, the agent's reply arrives
  as a notification again. Before, the reply showed only when you opened the app.
- WhatsApp, Telegram, Slack and Discord show **Paused**, not **Connected**, when all their numbers,
  chats or workspaces are paused. The agent's card in the chat now opens the connector page, where
  **Resume** turns each place on again.
- The Obsidian app that you add from your phone now connects to the Local REST API plugin with the
  plugin's default settings. Before, each Obsidian tool failed until you turned on "Enable
  non-encrypted (HTTP) server" in the plugin.
- A thread composer has the dictation mic of the agent's chat again: it writes your words into the
  draft, and nothing goes before you tap Send. It replaces the round voice button that sent after a
  review.
- A thread composer offers the agent's skills and apps after `@`, as the agent's chat and desktop
  threads do. On a server that takes files in threads, Use skill or app is also in the + card.
- The video viewer shows the video in the middle of the screen, not low under the buttons.
- With the Natural response style, a chat no longer shows a filler progress note, such as one "x"
  before each step of a routine run, or a note that repeats an earlier note of the same turn. The
  note stays in the turn's steps.
- When OpenBot could not enter a password or code from the secure card, the browser card now says
  that OpenBot could not finish and that you must enter what is missing on the page.
- In the step list of a workflow, a long step text was cut off at the edge of the screen. It now shows
  on up to four lines.
- A GitHub trigger with more than one repository showed only the first one. When you chose a
  repository on the phone, the trigger kept only that repository.
- A video step showed as "Image", and the result of an image or video step showed as a file id.
- In the browser of a server, a "Copy" button on the page now puts the text on your phone's
  clipboard, for example the code on a sign-in page. The server must also be on the new version.
- The Edit button on a draft that an agent asks you to approve now opens the draft as text in the
  card. Change it, then press Send or Keep draft, and the agent uses your text. Before, Edit closed
  the card. The server must also be on the new version.
- Show the question of a channel member in the channel when the member asked it in work that it
  started by itself. Before, the agent showed "Waiting for you in" the channel, but the channel had
  no question to answer.

### Security

- Say under the API keys of a server's Vault that every agent can read the key files of the other
  agents, because all agents run as the same system user. Before, the text said that agents read
  each key from a private file, which was not true.

## [1.4.10] - 2026-11-16

### Added

- Connect Honcho or Hindsight from the Apps marketplace with browser sign-in or an API key, so agents can save and recall long-term memory that other AI tools you connect can share.
- Choose when Claude compacts the chats of a server's agents. On the Claude page of a server's
  Providers, set "Compact chats at" to a size from 100K to 1M tokens, or keep "Claude Code default".
  The server must also be on the new version of OpenBot.
- The Apps marketplace has 207 new apps, for example monday.com, Miro, Dropbox, Zapier, Datadog,
  Intercom, Granola and Webflow. Connect each one with browser sign-in to your own account. Some apps,
  such as Exa, DeepWiki and CoinGecko, need no account.
- You can mute an agent from its menu in the chat list. Touch and hold the agent and select **Mute**;
  **Unmute** gives it the notification level of the server again. The mute applies to you only, on
  each of your devices.
- You can turn off the “Working on it…” message of a WhatsApp number in Marketplace › Apps ›
  WhatsApp. OpenBot then posts only the answer. The server must also be on the new version.
- On a server with more than one account for a provider, you can turn on **Pool accounts** on the
  provider page. Agents then use one account until it nears a usage limit, then the account whose
  limit resets first. **In use** shows the account that agents use now. On an account page, **Leave
  out of pool** and **Put back in pool** remove the account from the pool or add it again. The server
  must also be on the new OpenBot version.
- Disconnect a server's first Gemini account in the server's provider settings. The server must be on
  the new OpenBot version.
- When an agent suggests an app, such as Canva or GitHub, the chat shows a card for it. Tap Connect to connect the app, or Skip to fold the card. The card says when only the server owner or an admin can connect the app.
- Server settings has an Agent personality page, as on desktop. An owner or admin can set the response style of the server's agents to Natural or Classic.
- On a server with the Natural style, the short updates that an agent writes while it works show as their own messages in agent chats, threads and channels.
- Open chat files larger than 10 MB on the phone. Tap the file to download it. A video or an audio
  file then plays in the chat, an image opens in the image viewer, and a document opens in the
  preview. Files up to 100 MB download; a larger file still opens on the desktop.
- Settings has a new switch, "Download large files automatically". When it is on, images, videos
  and audio up to 100 MB download when the chat shows them. It is off, so large files use mobile
  data only when you tap them.
- The chat shows a video that an agent makes. The video shows in its frame while the agent makes it,
  and then plays in the chat player. The server must also be on the new OpenBot version; with an
  older server, the video shows as a file.
- An owner or admin can choose who gets each MCP server on the page of that server: the agents that get it, and the access (No access, Can use or Can manage) of Everyone and of each role. The server must also be on the new version.
- Copy an image from a chat: the image viewer has a Copy button next to Share and Save.
- Touch and hold a message with files to copy, share or save them. Copy puts an image on the clipboard as a picture and a text file as text. Save puts an image in Photos and another file in a folder that you pick in Files. A message with more than one file opens a menu that names each file, with Share all, Save all to Files and Save images to Photos.
- You can pin and unpin messages in an agent's chat and in its threads. Touch and hold a message and tap Pin.
- Pinned messages opens a sheet with the pins of all chats of the agent, with the chat of each pin and who pinned it. Tap a pin to go to its message, or swipe left to unpin it. The server must also be on the OpenBot version that adds pinned messages on desktop.
- Server settings has a new Agents page, under Timezone. It has Personality, Memories per agent, and the new Memory review, Skill learning and Learn from my browsing settings, as on the desktop. Owners and admins see the new settings when the server runs an OpenBot version that has them.
- The Everyone page and the page of a role have "Set all", which gives one level to all agents.
- Chats with unread replies now show first in the chat list, as on the desktop. Choose "Sort chats" in the menu at the top right: "Unread in a group" (the default) puts them in an "Unread" group under "Needs you", "Unread first in folders" puts them first in each folder, and "Manual" keeps your saved order. Each phone keeps its own choice.
- Restart a server that you host yourself from the phone: as an owner or admin, open Server settings and
  select Restart. Before, only an OpenBot-hosted server had this row. The server must also be on the new
  version of OpenBot.
- You can change the app icon in Settings › Appearance › App icon. Swipe through the logo colors of
  the desktop app and tap Use this icon. On Android, the icon changes when you leave the app.
- Settings has a Billing page that shows the plan, the billing period, the next renewal or end date and the price of each cloud server. It shows only where cloud servers are available in the app.
- Set up two-step codes for the Vault logins of a server from the mobile app. Scan the QR code of the site with the camera, choose a screenshot of it, or paste the setup key, then check the first code on the site before you save. The Vault list shows the live code of each login with a key; tap it to copy the code. The server must be on OpenBot 0.66.0 or later.
- Settings has an Agents page for an owner or admin of a server, as the Agents tab of the desktop Settings. It shows the defaults for local scripts, new chats, the plan card and steering, which agents have each one on, and the OpenBot co-author line of git commits. You can change a default, the plan start time and the local script limit, and set each agent to follow the default or to its own value. The page also lists the background processes that agents left running on the server, such as dev servers, and you can stop one. The server must also be on the new version.
- An owner or admin can now edit a custom provider of a server in Server Settings > Providers: its
  name, base URL, models, API key and headers. Agents on a kept model stay on it. Leave the API key
  or the value of a saved header empty to keep the saved value. The server must also be on OpenBot
  0.66.0 or later; on an older server, you can still only remove the provider and add it again.
- Agent info > Model has a Speed choice in place of the Fast mode switch: Standard, Fast and, for a model that has it, Ultrafast. Claude agents can now use fast mode too: the app asks you to confirm the higher price first. Ultrafast and Claude fast mode need a server on the next OpenBot release; an older server keeps Standard and Fast.
- Connect Sunra from the Apps marketplace with browser sign-in, so agents can make images, videos,
  audio and 3D models with your Sunra credits.
- Connect TryPost from the Apps marketplace with browser sign-in, so agents can list your social media
  channels, draft, schedule, queue and publish posts, and read analytics.
- Server settings › Transfer has "Copy to another server" in the mobile app. Choose the server to copy to, select the agents, and copy them in one step, with no file to save and open. The agents keep their workspace files, and their channels and the Shared folder are copied too. API keys, sign-ins, connectors, and chat history are not copied. It shows when you are an owner or admin of two or more online servers. A server does not need a new version.
- The Library has folders. The folder button at the bottom of the screen shows where you are. Tap it to choose all files, an agent, a folder, or the files of deleted agents. Make, rename and delete folders, and move a file into a folder from its menu. A change on the desktop app, on another phone or by an agent shows at once. The server must run an OpenBot version with Library folders; live changes need this version on the server.
- Settings > Haptics has a Reply haptics switch. Turn it off to stop the taps while an agent's reply appears, and keep the other haptics.
- On an iPad or a phone with a hardware keyboard, Return sends the message. Shift+Return adds a new
  line. The screen keyboard does not change: its Return key still adds a new line.
- Read and allow long approvals on the phone. The app loads the full request from the server, and a bug report or an idea for the OpenBot team shows its full text in a box that scrolls. Before, the phone showed only the start and offered only Deny. The server must run the newest OpenBot version.
- OpenBot has two shortcuts in the iPhone Shortcuts app, for iOS 26 and later: List Agents and Send
  Message. You can also run them from the Action button, Siri or an automation.
  - List Agents shows your agents. A tap on an agent opens its chat.
  - Send Message asks for the text and sends it to your agent. The app does not open, and it does
    not need to be in the background. A card shows the result, and the reply comes as a notification.
  - **Choose the agent for Send Message in Settings > Shortcuts.**
  - With the app lock on, a shortcut opens OpenBot and asks for the lock.
- An owner or admin can add more than one Cursor account to a server in Server settings › Providers ›
  Cursor. Each account after the first uses a Cursor API key. The server must also be on the new version.
- Connect Adobe Analytics from the Apps marketplace with browser sign-in, so agents can find report
  suites, dimensions, metrics and segments, and run reports. Your Adobe administrator must give your
  account MCP access first.
- When you change the theme in Settings › Appearance, a soft wash of colors moves across the screen
  and the new theme comes in after it, as in the desktop app. Reduce Motion and the Animations
  setting turn it off. It needs the new app version from the store.

### Changed

- The marketplace shows Productivity, Documents and Design first, and Coding near the end.
- Hidden chats of a server on the new OpenBot version keep working. The Hidden chats screen says so;
  for an older server it says, as before, that a hidden chat does not run.
- Main buttons are now white in dark mode and black in light mode, as on desktop. They no longer flash blue when you tap them.
- Settings › Profile on the mobile app keeps its layout while your activity loads. The values and the
  year of days then animate into place.
- While a server is not connected, the drawer and Server Settings keep the rows of its last connection, such as Control computer, Library and Providers, and show them disabled. The rows no longer go away and come back.
- The top right button of a chat is now a More menu with the browser, the actions that a channel needs, and the pinned messages. The button has an orange dot when a channel needs your action.
- On Android, some launchers remove the OpenBot icon from the home screen once after this update.
  Add it again from the app list.
- If you have a cloud server, the plus button in the server list opens your cloud servers, also where the app does not show plans.
- A Vault login shows the user name and the password in one card.
- An agent's question now shows as a message, with its answers as buttons under it, as in the approval cards. "Reply in the chat" and "Skip" are buttons there too.
- When an Android phone cannot open a store for the update, Update opens the OpenBot download page.
  Before, it opened the Google Play website.
- The app reads its feature settings from the account service at most each 10 minutes, not each minute.
- The app now sends a smaller copy of each photo, up to 2048 pixels on the long side. A photo
  arrives faster, also on a slow connection. To send the original photo, turn on "Send photos at
  full quality" in Settings → Conversations.
- An agent chat or a channel with unread messages now opens at the top of the NEW section, as on desktop. Channels now also show the NEW line.
- When a server cannot send the full request, the card names the server and tells you to update it or open the chat in the OpenBot desktop app.
- The button that goes to the latest message now keeps the chat at the end while a reply arrives.
  Before, the button came back after each new line of the reply. A drag, or a message that you send,
  stops this.

### Fixed

- The model picker of a second Gemini (or other provider) account now shows the models of that
  account's plan, such as Gemini 4 Argon on an Ultra plan. Before, it showed only the models of the
  first account. The server must also be on the new version of OpenBot.
- Restart server no longer shows for a hosted server that the app cannot restart. Before, the action
  showed and then failed.
- Replies in Italian are read aloud with the Italian voice. Before, a reply with "è", "più" or
  "città" was read with the French voice.
- Settings rows show their full value again, such as the update status, the timezone and the member count, and the chevron is at the end of the row.
- On Android, sharing to OpenBot from another app opens a sheet again. In it you choose the server and the agent, add an optional message, and send the shared text, links, images or files from the sheet. The chat then opens. Files that the server does not take, or that are too large, show an error before anything is sent.
- The page of a role in Server settings › Roles now shows the access that its members really get.
  Before, an agent showed "No access" even when Everyone gave all members "Can manage". When Everyone
  gives more, the agent shows that level with "· Everyone", and lower levels are off. "Change in
  Everyone" in the menu opens Everyone.
- On a slow or unstable network, a joined server no longer shows "The remote request timed out." and
  fails to load the open chat while the server still answers. Before, the app stopped waiting for
  some reads after 15 seconds, also when they only waited behind earlier answers. Now a read fails
  only when the server sends nothing for 15 seconds, or after one minute.
- On Android, a text field with a Paste button no longer shows a dark box and a blue ring inside its frame.
- When an agent wrote a text, such as a draft reply, and then asked you a question about it in the same turn, the chat showed only the question. Now the text shows above the question until you answer it, as on desktop.
- Usage now shows the third usage bar of a server: the OpenCode Go and Kimi weekly or monthly limit,
  and the Cursor plan total. Before, the app showed only two bars. The server must also be on the new
  desktop version.
- Server › Storage on a hosted server now shows the free space of the plan, not the free space of
  the whole disk of the machine. The correct value on a virtual server needs the server on the new
  version.
- Chats on a server now show the latest messages after you come back to the app. Before, some chats
  that were not open could keep old messages until you closed and opened the app again.
- The chat is smoother while a reply arrives, most of all in a long chat. Before, each part of the
  reply made the app prepare all loaded messages and the message field again.
- A thread is smoother while its reply arrives. Before, the app drew the thread again for each part
  of the reply, also when many parts came at one time.
- A page or diagram card, a video and a card with a long draft keep one height when you scroll back
  to them. Before, they changed their height and moved the messages near them.
- A task list or a group of agent messages that you opened or closed stays that way when you scroll
  away and back. Before, it went back to its first state and moved the messages near it.
- A long code block shows faster when it comes into view.
- The chat no longer stops for a moment when a large file ends its download.
- When the ChatGPT plan limit of a server is used but its account has credits, the agent screen no
  longer says that the usage limit stops the model. Codex keeps working on the credits.

## [1.4.9] - 2026-11-12

### Added

- **Photos** in the attachment menu now also shows videos. Select a MOV or MP4 video to attach it to
  a chat, as on the desktop. A video must be 10 MB or smaller.
- **Search models** in agent settings and in Create agent. The Model row now opens a list of the
  provider's models with a search bar. Type a name or a model id to find a model without a scroll
  through the full list, such as the OpenRouter list (#6503).
- OpenBot can now get fixes between store versions. When a fix is ready, the home screen shows
  **A new OpenBot is ready**. Tap **Update** and the app restarts with the fix, with no visit to the
  App Store or Google Play. This works from this version on.
- **Settings → About** shows a short update ID after the version when the app runs such a fix.
- **API key for ChatGPT and Claude** in Server settings > Providers. When the server can read the
  key, the provider page has an API key row, as on the desktop. The key goes to the server only.
- **Default for new agents** on each provider page. Turn it on to make new agents of the server
  start with this provider. The page also shows how many agents use the provider.
- **Sign in in the browser** on a provider page when the server signs the provider in with a code.
  Use it when the code sign-in does not work.
- Give a channel its own picture in Channel info: upload a photo, or choose an icon and a color, as
  on the desktop. The channel list, the chat header and search show it in place of the member
  faces. A channel picture that you set on the desktop now shows on the phone too. The server must
  run this OpenBot version.
- Connect Postiz from the Apps marketplace with browser sign-in or your Postiz API key, so agents can list your social media channels, and draft, schedule and publish posts.
- Get a notification when an agent finishes or stops with an error in a thread. Settings >
  Notifications > Thread replies turns these notifications off on this phone. The server must run
  the next OpenBot version.

### Changed

- **Open the export agent** in the Grok Bot import guide now opens the new Migrator by OpenBot page
  in Grok Bot.
- The app now also looks for a fix when you come back to it, not only when it starts. It asks
  OpenBot's own update server, and it accepts only updates that OpenBot signed.
- The provider page has a new layout: a header with the provider logo, its status and its agents,
  then the Sign-in, Use, API key and Runtime sections. Each action, such as Reconnect, Update and
  Disconnect, has an icon, as in Settings. The API key opens on its own page.
- The sign-in page and the custom provider, custom agent and MCP server pages also have an icon
  on each action, such as Open sign-in page, Cancel, Add and Remove.
- The Models page of a provider shows the selected models in their own section, above the other
  models. Select all, Deselect all and Reset to default are in the menu at the top right.
- The provider page shows if the server runs the CLI that you installed or the one that OpenBot
  downloaded. The Disconnect question names the agents that stop until you sign in again.
- Channel info is shorter. The Agents row opens a list of the server's agents with a search and a
  menu to select or deselect all. The Lead agent row has a menu to choose the lead.
- An owner or admin can delete an agent from the end of Agent info.
- Consecutive routine markers in a chat, such as updated, completed or failed routines, now show as
  one closed row with a count. Tap the row to show or hide each marker. A routine that is running or
  needs attention keeps a row of its own. To show the markers open, turn off **Collapse routine
  activity** in Settings > Appearance.

### Fixed

- The number on an agent in the chat list now counts only the unread messages of its chat. Before,
  it also counted the messages of its threads, such as a routine's thread, so it grew with each
  routine run and opening the chat did not clear it. Unread messages in threads now show as a badge
  with no number.
- A turn that ends without an answer, for example one that you stop or that a restart interrupts,
  now shows its steps in a row of its own in an agent chat, a thread and a channel. In an agent
  chat and a thread, tap the row to open the steps. Before, its thinking was not shown after the
  turn ended, and a chat whose newest messages were only that thinking showed no rows, also after
  Load older messages.
- On Android, you can now share an audio file, a video, an email or a file of another type, such as
  a Garmin `.fit` activity, from another app to an agent. Before, the OpenBot share target showed
  only for text, images and documents when you shared one file (#6583).
- With large text, a settings row with a menu value, such as Reasoning on an agent's Model page, no longer flickers after you change its value.
- You can now import a Grok Bot export of more than 100 MB into a server from your phone. The app
  sends the export in parts. The server must be on the new OpenBot version.
- Messages no longer move while you scroll up through older messages of the same day.
- A tap on a notification of a thread opens that thread, and so does a tap on the Live Activity
  while it shows the work, a question or an approval of a thread. Before, both opened the main chat
  of the agent.
- A tap on the expanded Live Activity in the Dynamic Island that shows one agent opens the chat of
  that agent. Before, the app opened on the screen that it had.
- When OpenBot takes a fix back, the Android app now shows **A new OpenBot is ready**, as the iPhone
  app does. Before, it went back to the earlier version at its next start with no message.

## [1.4.8] - 2026-11-10

### Added

- Type `@` in an agent's chat or side thread to tag one of the agent's browser tabs or side threads,
  as on the desktop. The agent gets the tab and can use it, and it can read the tagged thread. A tagged
  browser tab shows as a badge in the message. Tap it to open that tab. The host computer must have
  OpenBot 0.62.0 or later.
- A tap on a file name in a chat message now opens the file from the agent's workspace or the shared
  folder. Text, Markdown, code, PDF and spreadsheet files open in the preview, and images open in a
  sheet. Other files open in the share sheet, where you can save them to Files or open them in
  another app (#5227).
- Manage the proxies of browser profiles in the mobile app. In Server settings > Browser profiles,
  an owner or admin can add, change and delete a proxy, such as `socks5://user:password@host:1080`,
  and choose the proxy of each named profile, or Automatic. A saved password shows only as a mask.
  The list also shows the computers that members share from the desktop app, and shows when a proxy
  does not answer, refuses the sign-in, or when a computer is offline. Before a change closes open
  tabs, the app asks. The phone cannot share its own internet connection.
- You can change the order of the tools in the server drawer, such as Threads, Schedule and
  Workflows. Hold a tool and select **Edit sidebar**, then drag the handles. The order is saved on
  this device.
- You can unpin a tool to hide it from the server drawer. Hold the tool and select **Unpin**. In
  edit mode, the pin button shows or hides each tool.
- Control a computer from the phone. Open the server menu and tap **Control computer** to see the
  computer's screen and use it like a trackpad. Pinch to zoom, type with the phone keyboard and the
  keys above it (Esc, Tab, Ctrl, Option or Alt, Cmd, arrows), and paste text from the phone. The
  ••• menu has Trackpad mode, Fit to screen, the computer's displays, the quality (Fast at 120 fps,
  Smooth at 60 fps or Data saver) and connection stats, and the help button shows each gesture.
  The phone asks for Face ID, Touch ID or the phone unlock first, and stops the stream when you
  leave the app. The computer must run OpenBot with remote desktop set up.
- On iPhone, the OpenBot share sheet has a message field. Type a message to send with the link,
  text or file that you share. The message goes before the shared content. If the share sheet
  cannot send and you open the app, the message is in the chat's message field.
- A server admin can select which models of a provider the model picker shows. Open **Server
  settings › Providers**, select a provider, then select **Models**. The page has a search, **Show
  all**, **Hide all** and **Reset to default**. Agents can still use every model.
- On the Claude page, a server admin can set how long Claude keeps the prompt cache.
- A server admin can disconnect the server's own sign-in of a provider, such as Claude or Codex.
- A server admin can reset the usage of a Codex account that has usage reset credits.
- The provider pages update when a change comes from the desktop app or another admin, such as
  the models of the model picker, the prompt cache time or a sign-in. You do not have to open the
  page again.
- Connect GitLab.com from the Apps marketplace with browser sign-in, so agents can work with projects, issues, merge requests, repositories and CI pipelines. For a self-hosted GitLab, add its MCP server address in the MCP servers settings.
- Connect Omnisend from the Apps marketplace with browser sign-in, so agents can read campaign reports and work with contacts, segments, campaigns and automations. Select read-only access on the Omnisend consent screen when agents only need reports.
- Connect ElevenLabs from the Apps marketplace with browser sign-in to turn text into speech, work with voices, and manage ElevenLabs voice agents. Each generation uses ElevenLabs credits.
- Use OpenBot in Hebrew. The layout mirrors from right to left when Hebrew is the language.
- A workflow output that posts into an OpenBot channel shows as "OpenBot channel". Choose the channel in OpenBot on the computer.
- **Settings > Profile** now shows your activity on your paired desktop, as the desktop Profile tab
  does: tokens, peak day, messages, streaks, a year of days, insights, your most active teammates
  and model usage.
- A menu at the top right of **Settings > Profile** has **Share** and **Sign out**. **Share** makes
  the same activity image as the desktop app and opens the share sheet.
- Settings › Appearance has a Message color setting: no color, the agent color, or a custom color that you select from presets or a color picker. A custom color also shows on your messages in channels.
- Settings › Appearance has a Text size slider, from 67% to 200%, as on desktop. It adds to the text size in your phone settings.
- Choose the ElevenLabs model that reads replies aloud, as on desktop: Flash v2.5 (the fastest, and
  the default), Multilingual v2 or Eleven v3. Open **Settings > Voice > Speaking**, check
  ElevenLabs, and select a model in **Model**.
- A Library in the server drawer shows every picture and file from the chats of a server, newest
  first, in a bento grid where pictures get the large tiles. You can filter them by type. A picture
  opens in the image viewer, and you can swipe through the pictures. A file opens in its preview,
  or in the share sheet. Hold a picture or a file to show it in its chat, share it, or delete it.
  Pull down to measure again.
- Talk with an agent by GPT live voice, as with Codex live voice on the desktop. Turn on GPT live voice
  in Settings > Voice and choose its voice. A voice conversation in an agent chat then uses OpenAI's
  live voice with the Codex (ChatGPT) sign-in of the computer that runs the server. Your voice goes
  between the phone and OpenAI, and the chat shows your requests and the agent's answers as usual. The
  computer that runs the server must have a version of OpenBot that supports GPT live voice; other
  servers keep the voice of the phone. Settings > Voice lists each server as ready, offline, in need
  of a newer OpenBot, or in need of a Codex sign-in, and an owner or admin can open the server's Codex
  page from there. When a start fails, the call bar shows the reason that the server gives. It needs
  this new version of the app from the App Store or Google Play: an update over the air does not add
  it.
- Use your own OpenAI-compatible voice server, as on the desktop: Speaches, Kokoro-FastAPI or another
  server with `/v1/audio`. Set it up in Settings > Voice > Voice server, then choose it for dictation,
  for spoken replies, or for both. The phone sends your recordings and the reply text only to that
  address, so the phone must be able to reach it.
- Dictate in English with Parakeet Unified, the English model of the desktop. It runs on the phone, adds
  punctuation and makes fewer errors than Parakeet v3. Choose it in Settings > Voice > Listening. It
  needs a phone with 6 GB of memory or more. Whisper turbo and Cohere Transcribe stay on the desktop
  only: they are too large for a phone.
- The Usage screen of a server shows the CPU, memory and disk use of its machine to owners and
  admins, in one row at the top. The values update every few seconds while the screen is open.
  Select the disk to open Storage.
- You can sign in with your company account, such as Microsoft Entra ID, Okta or Google Workspace.
  Enter your work email: when your company uses company sign-in, its sign-in page opens in place of
  an email code.
- Dictate with Qwen3-ASR, which runs on the phone. It finds the language you speak, in 30 languages and
  22 Chinese dialects, also when you mix Chinese and English in one sentence. Choose it in Settings >
  Voice > Listening and download the model (about 1 GB). Your speech stays on the phone. It needs a
  phone with 6 GB of memory or more, and this new version of the app from the App Store or Google
  Play: an update over the air does not add it. (#5713)
- Read replies aloud with Eleven v4 or Eleven v4 Turbo, the ElevenLabs models that speak more than
  90 languages. Open **Settings > Voice > Speaking**, check ElevenLabs, and select a model in
  **Model**. Flash v2.5 stays the default.

### Changed

- The ChatGPT code sign-in of a server now tells you to turn on device code sign-in for Codex in the
  ChatGPT security settings first. For a work account, the workspace admin turns it on.
- When a plan card waits a minute or more before it starts the work, its Start button counts down in minutes, such as "Start · 4:59", not in seconds.
- The Instructions file page of an agent now shows about 14 lines of the file instead of 4.
- On Android 12 and later, the bar at the top of sheets and pages now blurs the content that scrolls
  under it, and the blur fades out smoothly below the bar. Before, the bar was a solid color. This applies to
  home, Marketplace, Routines, Usage, Tasks, Workflows, Settings, Create agent and the other sheets.
- The icons for Threads, Schedule, Workflows, Usage and Marketplace in the server drawer and in
  search are now the same as in the desktop app.
- The Routines page of a server is now called **Schedule**, as in the desktop app. It shows the
  calendar of routine runs. You still manage routines in the info of each agent and channel.
- Server settings is now one page. The sections are Server (updates, timezone and memories per
  agent), People (your role, members, roles and audit log), AI and tools, Data, and Import and
  transfer. Refresh, Restart and Leave, Delete or Remove come next, and Server key is at the
  bottom. General and Maintenance are not separate pages any more. A row that is not available for your role does not
  show.
- The top of Server settings shows the server logo beside its name, with the connection status and
  the OpenBot version under the name. Owners and admins tap the logo to change it, and tap the name
  to edit it in place.
- The rows of Server settings and Settings have icons. Where the desktop app has a tab for the same
  setting, the row uses its icon.
- Profile has the same layout as Server settings: your photo beside your name, with your email
  under it. Tap the photo to change it, and tap the name to edit it in place.
- Consecutive completed runs of one routine now show as one row in the chat, as in the desktop app.
  The row shows the routine and the number of runs. Tap the number to show or hide each run. Runs
  on different days also join, so a daily routine no longer adds a row each day.
- You can now attach a file of any type to a chat on a server that supports it, for example a VPN
  profile (`.ovpn`) or a certificate (`.pem`). Before, the app refused a file whose extension was not
  in its list. The agent gets the file and reads it with its own tools.
- A voice conversation reads the agent's progress updates aloud while it works, and then the answer.
- A new agent now opens with its own short welcome, in your language, as a question with three first
  tasks that you can choose or answer in your own words. The setup message that OpenBot sends to the agent no longer shows in the chat.
  The first task that you write during setup still goes to the agent after its welcome.
- Connect Composio with a sign-in when your server can relay sign-ins. Otherwise, type only your
  Composio API key. You no longer type an MCP URL.
- The chat list keeps the sections and folders that you close. When you open the app again, they
  stay closed. Each server keeps its own sections on this device.
- **Sign out** moved from the bottom of **Settings > Profile** to the new menu.
- On iPhone, the value and the arrows of a selection row in settings are now gray, as on Android.
- The rows in the info of an agent now have icons, the same as in the desktop agent settings.
- In the info of an agent, **Routines** shows each routine as a card, as in the desktop app. The card
  shows the trigger icon, the name, when the routine runs, and a switch at the end. The switch
  pauses or resumes the routine. Tap the card to open the routine.
- A member of a joined server can see and add its MCP servers, and connect Marketplace apps, when the server allows it. A member changes or removes only the MCP servers that the member added.
- The Roles page of server settings is now named **Permissions**.
- When you come back to the app after a few minutes, it keeps its connection to your computer and
  is ready sooner. Before, every return after about 2.5 minutes made a new connection and loaded
  all servers again.
- When the phone moves from Wi-Fi to mobile data or back, the app renews its connection at once.
  Before, the connection could stop with no data for up to half a minute.
- A new connection to a server is faster, because the app starts the next steps while it waits for
  the account service.
- Tables in chat messages look as the desktop data tables do: a rounded card with the header on it, and the rows on an inset panel with a line between them.
- A table in a message stands out of the bubble, between the text before and after it, and its columns are as wide as their content.
- A table has Copy as Markdown and Copy as CSV under it, as on desktop.
- A code block looks as a table does: the language and the copy button on a card, and the code on an inset panel.

### Fixed

- A tap on a chat in the home list now always opens the chat. Before, after the app opened from a
  notification or connected to a server, a tap on a chat could do nothing until you restarted the app.
- A tap on a notification now opens its chat. Before, it could stop on the home list.
- An attachment download from a server that the server stops, or that arrives damaged, now fails at once. Before, it waited one minute for a timeout.
- Leaving a chat while dictation stops no longer leaves the voice action waiting.
- The back button of a chat always goes back to the chat list. Before, after a swipe back that you
  started and did not finish, the back button did nothing until you opened the chat again.
- When the selected server does not answer at start, the app no longer stops on the "Connecting to
  server" screen for up to 30 seconds. After 5 seconds the home shows the server as offline, and you
  can open the drawer or select another server while the app continues to connect.
- Chat and channel list previews, awaiting replies and search show a pasted file by its name, not as `@image.png`.
- When ElevenLabs refuses your key or a voice, the app now shows the reason that ElevenLabs gives,
  such as a free plan that does not allow the voice. Before, it showed "ElevenLabs did not answer",
  also when ElevenLabs answered.
- When you open a chat again, the messages that came while you were away show at once. They no
  longer play word by word with haptics, as if they were new. Only a reply that comes while the chat
  is open plays.
- The text of your messages is white on a dark message color. Before, the text was always dark and was hard to read on a dark agent color.
- After dictation ends, one press of **Send** sends the message. Before, after an earlier message,
  **Send** could do nothing until you touched the text field. This occurred mostly on Android, and
  sometimes on iPhone.
- In a voice conversation, the voice no longer reads the start of an agent's thinking before the answer.
- Search shows the agents whose name matches first. Before, an agent that had the word only in its
  description or last message could show above it, and the agent you named could be hidden in **All**.
- A connection that the app restarted many times, such as after many returns to the app, no longer
  drops when you open the app.
- In a message with a message color, code blocks, inline code, tables and mention chips follow the text color of the bubble: darker on a dark color with white text, lighter on a light color with dark text. The code has the color of the message text. Before, they stayed grey on the color, and code could be white on a light color.
- A code block in an agent's reply has a background that you can see. Before, it had the same grey as the bubble.
- When the first server in your list does not connect at start, such as a computer that is turned off, the app opens your first online server again. Before, a server that the phone kept from the last visit stayed open, and its chats did not load.
- Dictation in Chinese, Japanese or Thai no longer puts a space between two parts of what you said.
- The thinking sheet of a long run opens at once. Before, a run of many steps made the app stop or close when you opened its thinking.
- The thinking sheet shows all the steps of a long run, also after the app starts again. It reads the earlier steps from the server when you scroll up. Before, it showed only the newest steps.

## [1.4.7] - 2026-11-06 (iOS), 2026-11-09 (Android)

### Added

- The workflow editor shows Slack triggers and Slack outputs that you made on the desktop.
- Add lime and indigo to the agent colors. Agents that had lime show lime again, not green, and
  agents that had indigo show indigo, not violet.
- Agents can use more colors: sky blue, navy, pink, wine, brown, sand and gray. A server that keeps
  agent colors shows and saves the exact color. On an older server, the app saves the nearest hue.
- Use the app in Arabic. After a restart, the layout mirrors from right to left.
- Show each chat paragraph in the direction of its text, in all languages. Code blocks always read
  from left to right.
- In the workflow editor, a Condition step has a Model choice and an Effort choice, as an LLM step
  has.
- The agent's Runtime settings show the usage limit under the model when a spent plan window stops
  that model, with the time when the limit resets, as the desktop model picker does. The note uses
  the readings of the Usage screen and goes when the window resets.
- You can delete a message in a chat. Touch and hold the message, then select Delete. This works in
  agent chats, tasks and channels. The message goes from the chat for everyone. The agent can still
  remember it. You can delete your own messages. Admins, and members who can manage the agent, can
  delete any message. The server must have the latest version of OpenBot.
- You can send the text of a message in an agent chat to a channel. Touch and hold the message,
  select Send to channel, then select the channel. The channel opens with the text in its composer.
- A task thread shows the name of each other member who wrote a message in it.
- Change the speed of a message that is read aloud: 0.75x, 1x, 1.25x, 1.5x or 2x. The speed button is
  in the Read aloud row of the message sheet. The voice keeps its pitch, and the speed also applies
  to voice conversations.
- Connect a Coinbase or Robinhood account from the Apps marketplace. Agents can read balances, positions and prices, and place orders.
- Connect RevenueCat from the Apps marketplace with a secret API key to manage products, offerings and paywalls, look up customers, and read revenue charts.
- Add Download to the Hermes Agent page of a server. The server runs the official Hermes installer
  and shows its progress. Then Connect signs in with the Nous Portal code.
- Connect TickTick from the Apps marketplace with browser sign-in to see and add tasks, organize lists and tags, and track habits and focus records.
- **Settings → Support** has a link to open a ticket on the OpenBot Discord, the fastest way to get help.
- Add Mark unread to the actions of an agent's message. That message and the messages after it
  become unread, and the chat stays unread until you open it again. The server must have the
  latest version.
- Show a NEW line above the first unread message when you open an agent's chat, as on desktop.
  With chat colors on, the line has the agent's color. The line grows in from the NEW label.
- Owners and admins can add and change Telegram and Slack triggers and outputs in the workflow editor.
  Choose the chat, the Slack workspace and channel, the text filter, the action and the emoji, as on
  the desktop. The server must run a new OpenBot version and have a linked Telegram chat or Slack
  workspace.
- Owners and admins can link and manage the WhatsApp numbers of a server from the phone. Link a
  number with a pairing code, add the WhatsApp Orchestrator, choose the contacts and groups that can
  write, and approve pairing requests. The server must run a new OpenBot version.
- The Marketplace shows the connectors of the server under Apps, as on the desktop: Slack, Discord,
  Telegram, WhatsApp, GitHub, 1Password and Bitwarden, with the status of each. It also shows the MCP
  servers that you added. Owners and admins see them; a tap opens the settings of the connector or
  the server.
- You can select the Plush or Flat avatar style when you create or edit an agent. A flat agent shows the flat face of the desktop app in the agent list, chats and Live Activities, and breathes while it works. The face and colour stay the same when you change the style.
- Connect a server to Proton Pass from Marketplace › Apps. Sign in to Proton on the phone, or
  paste an access key. Agents on the server can then sign in to sites with the logins of one shared
  vault. The Proton Pass CLI needs a paid Proton plan.
- Settings > Voice has a "Pause before sending" slider, from 1 to 10 seconds. A voice conversation sends your words when it recognizes no new words for this long. The default is 1.5 seconds. (#5006)
- Settings > Voice > Speaking has a "Reply speed" choice for the replies that OpenBot reads aloud.
- Connect Higgsfield from the Apps marketplace with browser sign-in to generate images, videos and audio, and check credits and assets. Each generation uses Higgsfield credits.

### Changed

- Agent faces move less while they rest: the eyes look round a little and more slowly, and the
  group of characters on the welcome and empty home screens floats less. The "Agent faces" switch in
  Settings now also stops the group's float.
- In the live browser view, a pinch or a two-finger pan follows the fingers smoothly while the page
  streams.
- The app keeps your channels and their latest messages in its encrypted copy on the phone, as it
  does for chats. After a start the channels show at once, before the server connects.
- The picture of a chat with more than one agent shows the members as a cluster, as on desktop.
  The faces are larger and overlap. One member fills the picture, two sit side by side, and three
  make a triangle. A chat with more than four members shows "+" and the number of the other members.
- A new chat or channel shows a short hint at the left, without a card: what you can do and how to
  start. The hint has no suggested options and no close button.
- The support log keeps 5,000 events, not 1,000, and records each step of a reconnect after a return to the app. A saved log now shows where a slow reconnect stops.
- **Show log** in **Settings → Support** opens the support log on its own page, newest first, and **Show older events** shows more of it. New events appear while the top of the log is in view. Before, the Support page showed only the last 100 events.
- Show the number of unread messages on the corner of an agent's avatar in the chat list, as on
  desktop. The count includes the agent's threads. Before, a dot next to the name showed only that
  the agent had unread messages.
- Connectors are now only in the Marketplace, as on the desktop. Server settings › AI no longer has
  a Connectors row. Open Marketplace › Apps to connect or change Slack, Discord, Telegram, WhatsApp,
  GitHub, 1Password or Bitwarden.
- A filtered or searched Marketplace list has Load more, as on the desktop, so it shows more than the first 50 agents and skills.
- The avatar editor has the groups of the desktop editor: Style, Shape, Eyes and Color. You select the shape and the eyes separately. Random face and Reset to ID are next to the Shape name.
- When an agent has no name, the "Enter a name for this agent." message shows under the Name field after you tap Create or Save, not at the bottom of the sheet while you edit.

### Fixed

- Felt agent avatars no longer have a dark outline in the light theme. The edge of the fur now has
  the colour of the avatar.
- A question card of an agent shows a Markdown link in the question as a link that you can open. Before, it
  showed the link text and the address as plain text. The answered summary shows it the same way.
- To confirm an action that needs a second step, or the main button of a dangerous card, touch and
  hold the button; a tap does not send it. With VoiceOver or TalkBack, a tap asks again in the card.
  Before, one tap sent the action.
- A confirm card shows the draft with its formatting and links. A long draft stops at a fixed
  height, and "Show all" opens the whole draft on its own screen, where you can copy it.
- A confirm card with a choice, such as the sender address, shows the options as buttons in the
  card.
- A list with more than one answer, or with many options, shows the options in the card. Before,
  you typed the option names.
- A link in a question opens. Before, it showed as text with brackets.
- An expired, cancelled or answered form still shows what it asked, such as the draft of a confirm
  card and the options of a question, as on desktop. Before, it showed only the title.
- When you drag a chat to the top or bottom of the list, the list scrolls at the same speed at any
  frame rate. Before, it scrolled faster or slower when the frame rate changed.
- With Reduce Motion on, the group of characters fades away when you continue from the welcome
  screen. Before, it flew off the screen.
- The blinking OpenBot logo uses less battery: it draws no frames between blinks.
- When another app, such as a keyboard or Safari, opens `openbot://` while OpenBot runs, the app
  comes back on the same screen. Before, every server connected again and again until the
  connection service stopped the app for 60 seconds.
- Each chat and channel keeps its unsent text. Go to another agent and come back, and the text you typed is still in the message box.
- The agent list shows the work of an agent's side threads on the agent. The agent shows as working
  while one of its threads works. It shows as needing you, and moves to "Needs you", while a thread
  waits for an answer, an approval or a takeover. It shows as unread while a thread has a reply that
  you did not read, also in the count of a closed folder. Only reading the thread clears it. Before,
  you saw these states only in the agent's thread list.
- A message with a file and text that wraps to a second line no longer covers the reply under it.
- An agent's unread dot goes when you read its latest reply in the chat. Before, the dot sometimes stayed until you used Mark as read.
- On Android, the app no longer runs out of memory after you paste, insert or share a large image into a chat.
- On Android, the app could close when you turned or unfolded the phone, or changed the size of its window.
- On Android, the app no longer closes suddenly during animations. Before, a view could update at the
  same time on two threads, and the app crashed.
- Stop the Android app from crashing when a screen closes while another screen opens.
- Stop the Android app from crashing when you drag the keyboard in a chat two times quickly.
- After a return to the app, the open chat, the queue and the other requests answer sooner. Before,
  the app loaded every chat that it kept on the phone again after each connect, and your requests
  waited behind them for up to a minute. A closed chat now loads when you open it.
- When a server does not send the agent list or the read state in 15 seconds, the app connects
  again. Before, it could wait up to 10 minutes and showed the server as connected while nothing
  loaded. A chat or a queue that does not load in 15 seconds now shows an error, as on desktop.
- On iOS 17, the agent status in the Dynamic Island and on the Lock Screen shows again. Before, it
  stopped each time it opened.
- The mobile app uses less memory while a reply streams. Before, on iPhone, the app could stop
  after some hours of chat.
- When a voice conversation starts to listen while a reply plays, the iPhone app no longer stops.
  Only that part of the reply does not play.
- When the microphone changes while dictation starts, such as when headphones connect, the
  dictation stops with an error, and the iPhone app continues.
- On iPhone, the app no longer closes when you open the browser of an agent with an open tab, or
  when you open a new tab.
- On Android, a vertical scroll of the agent or channel list no longer moves a row to the side and shows Pin (#5102).
- A voice conversation with Parakeet or ElevenLabs Scribe no longer keeps listening in a loud room. Only new words keep the turn open, not noise.
- A chat no longer shows "Queue unavailable" when the connection drops.

## [1.4.6] - 2026-11-04 (iOS), 2026-11-05 (Android)

### Added

- The task actions of a channel now have a Cancel task button for a stopped or failed task, on a
  server that supports it. It ends the whole run of
  that task, and keeps the messages.
- The queue above the message field now shows the next queued message with Edit, Steer and Delete
  buttons. Steer needs one tap while the agent works. When more messages wait, a row under it opens
  the queue, and the card grows smoothly to show that row.
- You can now attach SVG images to a chat on a server that supports them. The agent gets the SVG
  file and reads its text. Replace on an SVG opens the file picker.
- On Android, the app icon can follow the themed icons setting of the phone, and its colors match the
  wallpaper. The launcher also gives the icon its own shape. Before, the icon did not change with
  this setting.
- The app keeps an encrypted copy of your agents and recent chats on the phone. After a start they
  show at once, while the app connects to the server. Sign-out deletes the copy.
- You can swipe left on your own message to reply to it, as you swipe right on a message of an
  agent. Before, only the Reply button under your message did this.
- Connect a ClickUp account from the Apps marketplace to search and update tasks, docs and team comments.
- Keep pinned agents and channels the same on the phone and on the desktop app. The server keeps the
  pins of each user, and a pin or unpin on the phone shows on the computer, and the reverse. A pin
  made without a connection goes to the server at the next connect. A server with an earlier version
  keeps the pins of each phone, as before.
- Hold a chat or a pinned chat, then move your finger to drag it. Drop it in the pins to pin it or
  to change the order of the pins. Drop it in the list to move it in its section or to another
  section, and to unpin a pinned chat. The list scrolls when you drag near its top or bottom. Hold
  without a move to open the menu, as before. On Android, the menu opens when you lift your finger.
- The chat list shows the folders of a desktop sidebar. A folder inside a folder shows its path,
  such as "Clients / Acme".
- Choose the None, Minimal and Ultra reasoning levels for an agent or a workflow step when the model
  on the server offers them.
- Server settings has an Audit log. Owners and admins see who joined or left, who changed a member's role or a custom role, and who changed the access of each agent, with a filter and a search.
- When an agent asks you to add a card, an address or a login to the Vault, the chat shows a Vault card. Add opens the Vault form with the values that the agent filled in. You type the card number, security code or password, and the agent gets only the name of the item.
- The Vault item form shows an example value in each empty field, in the format of the chosen country for an address, and says which fields are required.
- The folder menu has "New folder inside" and "Move to", so a folder can go into another folder or
  to the top level. The "Move to folder" menu of a chat has "New folder".
- An owner or admin can start a workflow from GitHub events and change GitHub from a workflow on the phone: choose the repository, the event, the labels and the filters of a GitHub trigger, and the action of a GitHub output.
- The workflow page shows the newest GitHub events of a GitHub trigger and what each one did. "Run with last event" runs the workflow with the newest issue or pull request that matches the trigger.
- The run of a GitHub event shows its issue or pull request, which opens on GitHub.
- A step of a workflow can run from that step, or alone. The workflow page shows the newest result of each step that ran alone.
- A step that runs has a Stop step button.
- Version history: open a saved version of a workflow, read its steps and make it current.
- A workflow with a Discord trigger or a Discord output shows its settings. Change them in OpenBot on the computer that runs it.
- Turn on Fast mode for an agent whose model has a fast tier, such as GPT-6.1-Sol, in the agent's Model page.
- Owners and admins can edit an agent's instructions file (`AGENTS.md`) on its server. When the agent changes the file during your edit, the app tells you, and a second Save replaces the agent's version.
- Compact the context of an agent's chat from the agent's Advanced page. The messages stay.
- Create a server on a computer that runs OpenBot: tap + in the server list, then "New local server on the computer". The server has its own agents, chats and files. The servers that OpenBot runs on that computer now show in the server list, with notifications.
- Hold a server that runs on a computer beside its own server and choose Delete server. OpenBot on that computer moves the server's data to its Trash. The server of the desktop app itself no longer shows Remove server.
- Dictate in a chat with the mic to the left of the main button. The words go into the message box
  while you speak, and you can edit them before you send. A wave shows your voice next to the time.
  Tap the mic again, now Stop, to keep the text. With an empty message box, the main button starts a
  voice conversation; with text, it is Send. Dictation uses the recognizer you chose in
  Settings > Voice.
- A message with two or more images, from you or from an agent, shows them as a stack of cards. Swipe the top card to the side to see the next image, and tap it to open the image.
- Tap the image count under the stack to see all the images of the message on one screen. Its menu saves all of them to Photos or shares all of them at once.
- The image viewer shows small tiles of all the images at the bottom. Tap a tile, or drag along the tiles, to go to an image.
- Server settings › Providers shows Kimi and Hermes when the server has them. You can download Kimi, and sign in Kimi and Hermes with a device code.
- The chat shows the day and time above the first message of each day, such as "Today 3:04 PM" or
  "Mon, Nov 1 9:12 AM", as on desktop.
- Branch from here: touch and hold the last agent answer of a finished turn, in an agent chat or a
  thread, and choose Branch from here. A new thread opens with a copy of the conversation through
  that turn, as on desktop. The server must have OpenBot with thread branches. While a turn runs, no
  message shows the action.
- A branch thread shows "Branched from …" after the copied messages, also for a branch made on
  another device. A tap opens the source chat or thread at the message that the branch came from.
- Workflows show their Telegram triggers and outputs. Change them in OpenBot on the computer that runs them.

### Changed

- An agent notification on iPhone, Apple Watch and Android now shows the agent picture, its photo
  or its bloub, in place of the OpenBot app icon. A notification whose picture is not ready yet
  looks as before.
- On iPhone, you can swipe right anywhere in a chat, a task or a channel to go back, and the chat
  follows your finger. Before, the swipe started only at the left edge of the screen. A swipe to the
  right on a message still replies to it.
- On iPhone, the headers of a chat and of the agent's browser use the native bar. When you open or
  leave a chat or the browser, its buttons change into the buttons of the screen under it, as on the
  other screens.
- On iPhone, a chat now slides in from the side. It no longer zooms out of its avatar in the list,
  and Settings > Animations no longer has the Zoom into chats switch.
- Product analytics and error reports now go also when analytics is off, with a random install ID in place of your account ID and email. The ID changes after 13 months. Message contents and files are never sent. The setting in Settings → Privacy is now called "Link analytics to my account".
- This update cannot read what the earlier versions kept in the iPhone keychain. You sign in again
  one time, and the app settings, such as appearance, language, haptics and voice, go back to their
  defaults. App lock is off until you turn it on again. Link analytics to my account is on until you
  sign in and the app loads your account's choice. If you turned it off only on this phone, it stays
  on.
- **Sign in again after you upgrade.**
- **Turn on App lock again in Settings if you used it.**
- **Check Link analytics to my account in Settings → Privacy if you turned it off.**
- Chat messages have tighter lines and less space between paragraphs and list items, so a reply takes less of the screen.
- A private answer to an agent's question, such as an API key, is typed in a masked field in the place of the message field, as a browser password is. The chat no longer shows a second field in the question card.
- Chat list folders look and work as on the desktop. A folder shows a folder icon, and a folder in a
  folder shows its parent name before its own name. A closed folder hides the folders in it and
  shows its unread count.
- Agents that have no photo now show the soft felt plush of the desktop app, in the agent list, chats,
  mentions, search, notifications and the Live Activity. A working agent looks up while three felt
  dots pulse, an agent that waits for you shows a felt dot, a failed turn shakes "no" once, and an
  asleep agent closes its eyes as z's rise. The orbit rings now turn only around an agent photo.
- When you choose a new face or colour for an agent, the old plush shrinks away and the new one pops
  out.
- After a start, the drawer shows the last member count, usage cost, next routine, thread and
  workflow values and pinned workflows at once. The server's own values replace them when they
  arrive. Before, these values were empty and then appeared one by one.
- In an agent chat, Send and Stop in the message box have the agent's colour. Before, they were
  blue.
- In a channel, a tap on the mic dictates into the message box. Before, the words showed on a
  separate screen and you could only send them as they were.
- The app opens your servers faster after a start. It keeps the server list on the phone and
  connects at once, while the account service answers. The first reads of each server go out with
  its connection check, and the account session request starts while the connection page loads.
- After a return to the app, the other servers no longer wait for the selected server when it
  cannot connect.
- Connect, Reconnect, Add account and Sign in again open their own sign-in page. The page closes when the sign-in ends.
- A provider sign-in shows numbered steps before you go to the browser. A page whose address you must copy back no longer opens before you see the steps.
- The code and address fields of a sign-in have a placeholder and a Paste button. The API key field has a Paste button too.
- A provider page shows its actions, such as Reconnect and Check for updates, at the bottom. The API key and its field are one section.
- Touch and hold a message to open its actions in a sheet: reactions, Reply, Copy, Read aloud and
  Select text, with the time the message was sent. The row of buttons under each message is gone, so
  the chat shows more messages. Reactions stay under their message, and a swipe still replies. While
  you hold, the message presses in, so you see when the sheet is about to open.
- To select part of a message, touch and hold it and choose Select text.
- Messages sit closer together, and chat bubbles have smaller rounded corners.
- Server settings is now a short list of pages: General (status, role, timezone, memories per agent and server key), People (members, roles and audit log), AI and tools, Data (vault, browser profiles, sites, storage, import and transfer) and Maintenance (updates, refresh and restart). Each row names the items on its page. A page that has no items for your role does not show. Leave, Delete and Remove stay at the bottom of the list.

### Fixed

- With a large text size, a settings row puts a long value, such as a model name or an account,
  under its title. Before, the value squeezed the title to one letter a line.
- On iPhone, the model and account menus show each name in full. Only the selected name in the row
  is shortened.
- On iPhone, headings in a finished reply were not bold, and its text changed from Inter to the system font when the reply finished.
- Inline code in a message sat higher than the text around it.
- On iPhone, a message bubble with text on more than one line was wider than its text, with empty space on the right.
- A GitHub or Discord output showed as "Notification" in the steps of a workflow.
- The Dynamic Island and the Lock Screen now show the photo of an agent. Before, they showed an
  empty grey circle in its place, because the photo was too large for the Live Activity. While a
  photo loads, the activity shows the plush of the agent.
- In a voice conversation the microphone opens again after a reply. Before, the app could stop, or
  show "Dictation stopped", when the reply or a new audio route changed the microphone.
- On iPhone Duo, the app now fills the screen. Before, it showed in a small window in the middle of the open screen.
- In a voice conversation, "Speak now" shows only when the microphone listens. Before, it showed while
  the microphone was still opening, and the first words were lost.
- In the image viewer, an image could show under the buttons at the top.
- The first time the image viewer opened, its buttons showed under the status bar.
- SVG images in a chat now show as pictures, as on desktop, not as file cards. They also show in
  the image viewer, the gallery, the queue and the agent files. The photo library does not take SVG
  files, so Save to Photos is not available for an SVG, and Save all skips SVG files.
- When you send two or more images in one message, the chat now shows them as a stack of cards at once. Before, it showed each image separately until the upload was complete.
- The reply preview now opens together with the composer and the keyboard, with no height jump first.
- On Android, notifications and the sound preview in Settings play the sound that you choose. Before,
  they always played the Android notification sound.
- In a voice conversation in a loud room or outside, your turn now ends when you stop speaking. Before,
  the noise kept the microphone listening, and the message was never sent.
- On iPhone, the ⋯ button of a thread and of the browser opens its menu again. Before, the menu had
  no items, so a tap did nothing.

## [1.4.5] - 2026-11-01 (iOS), Skipped (Android)

### Added

- The server plans show how many hosted sites each plan has.
- Owners and admins can set how many threads of an agent run at the same time in **Agent info → Advanced → Parallel threads**, as on desktop. **Default (2)** uses the host default. When the provider runs one turn at a time, the control shows 1, and the threads of the agent wait for each other.
- Agent info › Advanced now has **Agent starts new chats**, as on desktop. When it is on, the agent starts a new chat when its chat gets long, and saves notes first. Only an owner or admin of the server sees it, and the server's computer must have the latest OpenBot version. A change on the phone shows at once on the computer, and a change on the computer shows at once on the phone.
- Manage the browser profiles of a server in Server settings > Browser profiles: add a profile with
  its name and color, rename it, change the color, choose its agents, clear the data and delete it.
- Choose the browser profile of an agent in Agent info > Advanced > Browser profile, or add a new
  profile for the agent there. A change made on the desktop or another device shows at once.
- Agent settings have a **Backup models** page, as on desktop. An owner or admin of a server sets the ordered list of models that the agent moves to when a usage limit stops it, and chooses if the agent asks first or switches by itself. Changes from the phone show on desktop at once, and changes from desktop show on the phone while the page is open.
- An owner or admin can now turn "Show the plan before long tasks" on or off for an agent, in Agent
  info > Advanced. The server must run the latest desktop version.
- In a thread, tap "Thinking…" or the steps row above an answer to see the agent's thoughts and progress steps, as in an agent's chat.
- **Agent settings → Folders** shows the folders that the agent can change besides its workspace.
  An owner or admin can add a folder of the host computer, remove it, exclude a folder in it, or
  include it again. The folder browser goes to the home folder or to a disk in one step, and the
  page opens Permissions. Changes from the desktop show at once. The host needs the latest OpenBot.
- **Server settings → Server key** shows when the server last changed its key. The owner can change
  the key there, after the app lock when it is on. The server signs the change with the current key
  and the new key, and the app uses the new key only after it checks both signatures.
- Server settings has an Import agents page. Any member can bring agents from a Grok Bot or Hermes Agent export: the page shows how to make the export, sends the .zip file from your phone to the server, and lists its agents and channels before anything changes.
- Server settings has a Transfer page for an owner or admin. Export the server's agents and server settings to a transfer file and share it from your phone, or import a transfer file from another OpenBot server. A file from a phone must be under 100 MB.
- A speaker button under each agent message reads the message aloud with the reply voice from Settings > Voice. Tap it again to stop. When another message starts or a voice conversation opens, the reading stops.
- Show provider plan limits on the server Usage screen: how much of each limit window is left, when
  it resets, and the provider's rings.
- Show each agent's avatar with a provider badge in the agent rows of the server Usage screen.
- Add a custom provider to a server from the mobile app: Server settings > Providers > Add custom provider. Start from Ollama, LM Studio or any OpenAI-compatible endpoint, then give its address, an optional API key, its models and headers. You can also see and remove the custom providers of the server.
- Install, update and remove agents from the ACP registry on a server from the mobile app: Server settings > Providers > ACP registry.
- Manage the accounts of a provider that can hold more than one: add an account, sign it in again, rename it or remove it on the provider's page in Server settings > Providers.
- Add, change and remove the custom ACP agents of a server: Server settings > Providers > Agents. Start from Goose, Qwen Code, GitHub Copilot or Oh My Pi, or give your own command, arguments and environment variables. The server must run the newest OpenBot.

### Changed

- When the connection service restarts, each app waits a random 0.5 to 4 seconds before it connects again. Before, all apps connected again in the same half second, and many of them had to try again. Open chats and connections to your servers stay up while the app waits.
- Your analytics answer follows your account. When you change **Settings → Privacy → Share product analytics**, the account keeps your answer, and your other devices use it after sign-in. When you agree on desktop or web, the phone turns analytics on after sign-in. An older choice from a phone that was offline does not replace a newer one.
- If you turned analytics off before this version, an analytics answer from another device does not turn it on again on that device. Only a change on that device turns it on.
- The button that opens the server list now shows a sidebar icon, not a stack of layers.
- The plan that an agent shows before a long task is easier to read. Its steps show as a numbered
  list, and its choices show as pills under the plan. The start button counts down to the time when
  the work starts by itself, as on desktop. After the answer, the card shows the choice, or says
  that nobody answered in time. The countdown needs the latest desktop version on the server.
- In agent settings, the field that teammates read to choose who does a task is now named
  Description.
- Chat messages in the mobile app use more of the screen width. Agent replies, approvals, questions and your messages now use up to 92% of the width, up from 88%.
- The notification settings show only the agents that have their own level, with their avatars, as on desktop. Use "Choose for one agent" to give one more agent its own level. Tap an agent’s level again to follow the server, and its row closes smoothly. A long list of agents no longer fills the screen.
- The server menu shows the logo of the open server at the left of its name. The menu items scroll under the header, which blurs them as the other screens do.
- A tap on an agent row in the server Usage screen opens the usage of that agent. The agent filter
  is removed. The agent Usage page shows the agent name in its title.
- Keep the values of the two Usage summary cards on the same line when a label wraps.

### Fixed

- Connect to your server again within about 30 seconds after the server comes back. Before, the
  app could wait up to 2 minutes after five failed attempts.
- When you open the thinking of a running reply and its steps are short, the steps now show below the sheet title. Before, they started under the title, and you had to scroll to see them.
- A long thread title no longer pushes the chevron in the thread header against the edge of the title button.
- After a server changed its key, the app used the previous key until it restarted, so it could not
  connect. Now it connects with the new key when it loads the server list.
- The server key section shows a key change from another device when you open Server settings.
  Before, it showed the change only after the app restarted.
- When you crop a server logo, the crop area has the rounded-square shape of the logo, not a circle.
- Keep the plan-limit rings in the home header when the host reports the usage of one provider. Before,
  the rings of the other providers went away for a moment. A new reading now moves the ring fill.

### Security

- The app keeps the first key that it sees for each server, also for a server that you joined on
  another device. A later key change is used only when the previous key signed a handover to it.
  Otherwise only the connection to that server fails, and the other servers stay available.

## [1.4.4] - 2026-10-31

### Added

- Tap the activity row of a working agent to open a sheet with each thought of the turn in full and the progress lines between them. The sheet updates live and keeps the newest text in view until you scroll up; "Latest" goes back to it.
- A finished turn shows a row above its answer with how long the agent thought and its step count. Tap it to open the same sheet for that turn.
- iPad support. The app fills the iPad screen in portrait and landscape.
- On a wide screen, such as iPad, an open iPhone Duo or an open Android foldable, the chat list stays beside the open chat.
- On a wide screen, you can drag the edge of the chat list to make it wider or narrower. Drag it to the left to show only avatars.
- iPhone Duo support. When you open iPhone Duo, the chat list and the chat show on each side of the fold. When you fold it, the open chat stays open.
- When a new version of the app is available, home shows a header with the OpenBot eyes. Tap Update to open the store page, or Later to hide it until the next version.
- An update that does not need the store installs in the app: Update restarts OpenBot with the new version.
- Tap What's new under the update buttons to read the release notes of each new version. The notes slide down from under the header, over the chat list.
- Settings › Notifications is now the one place for notifications: choose a server, then All, Needs me, or Off for the whole server and for each of its agents. These choices apply on all your devices, and a change shows at once on the others; a mute applies to this phone only. The agent screen shows the level and opens Settings › Notifications; the server settings no longer have a Notifications row. The agent screen no longer has its own Notifications switch, and "Notify me about" opens the Notifications view inside the agent sheet. An agent that was switched off for everyone shows "Turn on". The server needs the latest OpenBot.

### Changed

- "Waiting for replies" shows when a teammate waits for your approval, your answer or you in the browser, with the command or the question. Review, Answer or Take over opens the teammate's chat.
- Code blocks in chat now wrap long lines, so you can read an email draft or a long command without scrolling sideways. Line breaks and Copy do not change.
- The MCP server screen now says that Claude and Codex agents get a server that has a working directory.
- The Live Activity shows the first sentences of a reply, without code blocks, headings or mail headers, and hides secrets and email addresses as "•••". Approve shows only for a command that it shows in full.

### Fixed

- Show the reason of a group chat task that stopped because its member was removed or is not
  available in your language. Before, the reason was always in English.
- Show all of an iPhone message that starts a line with an agent name, code or a link. Before, the
  lines had too much space between them, and the end of the message was cut with "…".
- Buttons and text no longer go under the side bar of iPhone Duo or the screen edges in landscape.
- On iPhone Duo with the side bar, the chat buttons now go into the side bar, as on the home screen.
- On iPhone Duo with the side bar, page titles no longer go under the blur at the top.
- Open a server that is online when the app starts and the first server of the list does not connect
  in 4 seconds. Before, the app stayed on that server for 30 seconds or more, for example when the
  computer of that server was asleep. The order of the servers does not change.
- Open the iPhone app on iPhone Duo. Before, the app could stop on a black screen at start.
- Open the mobile app in Expo Go. Before, it showed an error that the `ReservedRegionsView` native component is not registered.
- A sign-in code request waits up to 35 seconds for the account server, as on desktop. Before, the app showed that the account service was not reachable after 10 seconds while the server still sent the code.
- The Live Activity in the Apple Watch Smart Stack fits its card: the agent photo, the name, two lines of text and the unread count, with a margin at each edge. Before, the watch showed the Lock Screen layout made smaller, with the content at the edges and the unread count outside the card.
- The Live Activity starts again when you open the app after iOS or the computer ended it. Before, it could stay frozen on the Lock Screen and in the Dynamic Island for hours. An activity that is almost 8 hours old also starts again, so iOS does not stop it while you are away.
- Notifications show the agent name and the text also after the app starts without network. Before, they showed only "OpenBot", and a tap opened nothing.
- Notifications start to work when Apple or Google gave no push token at the first try. Before, the phone got no notifications until you opened the app again.
- Notifications and Live Activity updates reach an iPhone app that is not from the App Store, such as a build that Xcode installs or an ad hoc build. Before, the app could name the wrong Apple push environment, and Apple refused every notification and update for it.
- Show the full names in the chat + menu. Before, a long name, such as "Use skill or app" in Polish, was cut off.

## [1.4.3] - 2026-10-29 (iOS), 2026-10-31 (Android)

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
