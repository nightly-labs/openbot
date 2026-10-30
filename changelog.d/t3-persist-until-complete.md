### Changed

- An agent that ends a turn with open steps in its plan now continues by itself, up to 3 times for
  one request. It stops when the plan does not change, when it waits or asks you, or when you stop
  it or send a new message. Steps that were already open before your request do not count. A short
  line in the chat shows each automatic continuation.
- Agents now finish the whole request before they end a turn. They do not stop only to report
  progress or to ask whether to continue.
