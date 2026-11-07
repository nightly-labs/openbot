### Added

- The chat now shows what an agent says between its steps, such as "I found the config, now I check
  the logs", as messages while the agent works. Its thinking stays in the steps. This works for
  Claude, Codex, Grok, Pi and the ACP agents. Grok's thinking also stays in the steps. Agents now
  write a short update only when a finding changes the plan or before a long step: what they
  learned and what is next. This is the new "Natural" response style of a server. To get the old behavior, choose
  "Classic" in Server settings → Personality.
- With the Natural style, an agent that uses a tool first writes one line: what it understood and
  what it checks first. Its final answer starts with the verdict, explains technical terms in a few
  words, and says what it could not check, and whether a read-only task still wrote files.
- While a Claude agent runs a command or a subagent, the activity line shows the agent's own short
  label of that step, such as "Find three largest folders in ~/Library/Caches", in place of a
  general text.
- The activity line of Codex, Grok and the other agents now names the running step from its
  command, such as "Reading the file main.ts…", "Measuring folder sizes…" or "Visiting github.com…".
- While a tool step runs, the activity line keeps its label and no longer changes to "Waiting
  for…" after a few quiet minutes.
- With the Natural style, a Claude agent gets the opening-line rule again with each message, so a
  long chat keeps the short first line.
- With the Natural style, the "Working on it…" post in Slack, Discord, Telegram and WhatsApp shows
  the agent's newest progress line, such as "Measuring folder sizes first", until the answer
  replaces it. Secrets are removed, and the agent's thinking never goes there. The Stop button stays.
- With the Natural style, the activity line of an agent chat shows only what the agent does now,
  such as "Checking Poland's weather". It has no general label, timer or step list. Each new step
  label rises into place, and the label stays while the agent reads the step's result. The avatar
  shows what the step does: a curious look for a search, wide eyes on a web page, a focused look
  while it reads, an eager one while a command runs, and the thinking dots between steps. The
  Classic style keeps the old line.

### Changed

- In an agent chat, the steps of a turn now show under the answer, as a channel shows them. Select them to open the trace. With "Show agent steps" on, the open list stays above
  the answer.
- A message now shows only React, Reply and a More button (⋯) when you hover it. More opens the
  same actions as a right-click: Copy, Read aloud, Send to channel, Branch, Mark unread and Delete.
- An agent chat no longer shows the time under each message. A centered time shows above a message
  on a new day or after a pause of one hour or more.
- Messages sent one after another, by an agent or by you, now read as one block: where two
  bubbles meet, their corners are smaller. All the updates of one agent turn stay in one block,
  also when a long step keeps the agent quiet for more than 5 minutes.
- The actions of your own text messages now show beside the bubble, on its left, so your messages
  sent one after another stay close together. A message with images keeps its actions under it.
- To get the full action row and the time under each message again, turn off Settings → General →
  Compact message actions.
