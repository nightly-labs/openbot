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

### Changed

- In a thread, the steps of an answer now show beside it, with the reply and menu actions, as in the
  agent's chat. "Show agent steps" still keeps the open list above the answer.
