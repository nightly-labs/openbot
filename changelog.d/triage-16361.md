### Fixed

- A message that you send to a busy Claude agent now always gets an answer. Before, when Claude read the message only after its task ended and another Claude chat finished at the same moment, OpenBot could close the agent's Claude session first: the chat showed the message, but no answer came. A message that Claude did not read before its session closed now goes back to the queue and runs next. A joined server gets this fix when the server is on this version too.
