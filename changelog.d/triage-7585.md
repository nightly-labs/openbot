### Fixed

- An agent that did a task for another agent no longer has to post a message in your chat with it after
  it sent the result back. Its turn now ends quietly, with no notification and no unread count, and its
  text stays folded under the teammate's message. Before, only a teammate's update that wanted no answer
  could end this way, so each delegated task added a message that repeated the result.
