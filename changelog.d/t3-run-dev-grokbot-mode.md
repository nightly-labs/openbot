### Changed

- When you send a message, the chat moves to your message at once, and the message slides in.
  Before, the chat glided down and a long message pushed the chat.
- The message box grows from one line when your text wraps, and stops at 6 lines. Then it scrolls.
  When you send or clear the text, it goes back to one line in one smooth move.
- The working agent shows about 0.75 s after you send, so it no longer comes in while your message
  still moves.

### Fixed

- The queue above the message box closes in one smooth move in the chat, in a side thread, and in
  the browser panel. Before, it stopped for a moment and then jumped.
- A send no longer stops the chat for a moment the first time a turn plays the classic completion
  sound.
- A message that you send to an agent that does not work no longer shows in the queue for a moment
  before it goes into the chat.
