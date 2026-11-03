### Fixed

- A channel member always gets the current assignment and the request messages of its task. The assignment is first in each turn, and a short assignment comes again at the end (#3557, #3630).
- A channel keeps its summary when a message is only marked as superseded. Before, the next turn summarized the whole history again (#3761).
- A channel turn no longer sends a member its own replies or the task instruction again. The newest messages fill a quarter of the context, and older messages are in the channel summary (#3905).
- A long channel no longer stops a turn while the oldest message that is not summarized still arrives. The turn gets the newest messages, and the summary goes on when that message is complete.
- A channel summary uses the model of another member when the lead's model is not available (#3957).

### Added

- A channel setting, "Keep memories in this channel". When it is on, an agent saves what it learns in the channel as a channel memory, and its other chats do not get it (#4332).

### Changed

- A channel summarizes long history in the background after a turn, so the next turn starts sooner.
- An agent shows a notice when two compactions in a row leave its context almost full, and then stops compacting automatically.
- An agent shows a notice when its provider retries a request 3 times. When the context is half full or more, the agent compacts it before the next turn (#4374).
- A channel turn after the first sends less: no fixed rules again, and the channel facts only when they change (#3380).
- A long request is in a channel turn once. A long handoff of an agent and a long message in `channel_history` are cut, and the agent can read the rest. A `channel_history` page also cuts a long task instruction or expected result.
- An agent compacts its context before a turn whose input would fill it.
- A channel summary uses the provider's smaller model when the lead uses a larger one.
