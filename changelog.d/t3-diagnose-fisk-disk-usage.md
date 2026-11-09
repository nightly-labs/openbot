### Fixed

- An agent's queue no longer starts the same message again and again while the agent waits on a question that it asked itself. Before, a routine turn that ended in the same chat made the chat look idle. The queue then tried to start a turn several times a second until the question ended. One server wrote 66 GB to its database in a day this way, and the disk became full.
- A chat database no longer grows when a queue only moves. A change of queue position is shown at once, but it is not saved again for each queued message. A chat update that the next update replaces whole is no longer kept in the history.
