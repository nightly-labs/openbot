# Changelog

All notable changes to the OpenBot iPhone app will be documented here. The project follows
[Semantic Versioning](https://semver.org/). Notes for the next release are in
[`changelog.d/`](changelog.d/README.md). The changes of the desktop app and the web client are in
the [root changelog](../../CHANGELOG.md).

## [Unreleased]

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
