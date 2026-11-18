### Fixed

- When you ask a Claude agent to watch a long job, the agent wakes each time its background check ends.
  The first answer after your request still shows. Later wakes with nothing new can now end quietly,
  with no unread post and no notification. Smaller models, such as Haiku, can still post on each wake. For an agent on a joined server, the server must also be on this
  version.
- A report that an agent writes after its background work ends now always shows, unless the agent
  says that it has nothing new. Before, after a quiet update, such a report could be hidden.
- After a restart, a thread no longer shows a second copy of the answers that a Claude agent gave
  when its background work ended, or a loose steps row.
- A Claude agent that waits for its background work no longer gets "The agent stopped before its next
  step. It continues". The agent continues when the work ends.
- In an agent's chat, the "working" row no longer stays after the agent ends its turn. Before, it could
  stay until you sent a new message.

### Changed

- While a Claude agent waits for its background work, its chat or thread shows "Waiting for
  background work…" with the time since it started. The row goes away when the work wakes the agent.
  For an agent on a joined server, the server must also be on this version. The iPhone app does not
  show the row yet.
- In a thread, the steps of an answer now show beside it, with the reply and menu actions, as in the
  agent's chat. "Show agent steps" still keeps the open list above the answer.
- A thread now looks like the agent's chat. Messages by one sender in a row read as one block, a
  separator shows the day and time, and the "working" and "waiting" rows stand right under the last
  message. With compact message actions, the time no longer shows under each message.
