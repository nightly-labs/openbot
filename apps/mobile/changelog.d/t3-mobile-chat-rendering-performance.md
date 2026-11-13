### Changed

- The button that goes to the latest message now keeps the chat at the end while a reply arrives.
  Before, the button came back after each new line of the reply. A drag, or a message that you send,
  stops this.

### Fixed

- The chat is smoother while a reply arrives, most of all in a long chat. Before, each part of the
  reply made the app prepare all loaded messages and the message field again.
- A thread is smoother while its reply arrives. Before, the app drew the thread again for each part
  of the reply, also when many parts came at one time.
- A page or diagram card, a video and a card with a long draft keep one height when you scroll back
  to them. Before, they changed their height and moved the messages near them.
- A task list or a group of agent messages that you opened or closed stays that way when you scroll
  away and back. Before, it went back to its first state and moved the messages near it.
- A long code block shows faster when it comes into view.
- The chat no longer stops for a moment when a large file ends its download.
