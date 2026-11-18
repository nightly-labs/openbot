### Fixed

- When you ask a Claude agent to watch a long job, the agent wakes each time its background check ends.
  The first answer after your request still shows. Later wakes with nothing new now end quietly, with
  no unread post and no notification. For an agent on a joined server, the server must also be on this
  version.
- A report that an agent writes after its background work ends now always shows, unless the agent
  says that it has nothing new. Before, after a quiet update, such a report could be hidden.
