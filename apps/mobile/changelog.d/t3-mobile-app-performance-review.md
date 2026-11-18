### Fixed

- The app is faster while an agent replies. Before, the open chat did its work again for each frame
  of a reply, and each message to an agent made all messages in the chat show again.
- An open chat uses less battery. Before, it animated a hidden agent face all the time.
- Home, the chat list and the agent faces use less power while agents work. Before, each row read
  the same agent state three times, and each moving face made new drawing objects for each frame.
- The Threads page scrolls smoothly with many threads. Before, it drew all threads at once.
- Headers and sheet edges use less power while you scroll. They now use fewer blur layers.
- A channel reply updates with less work. Before, a change in a channel also showed the other open
  channels of the server again.
- A screen that you open from the side menu shows when the menu has closed. Before, it waited a fixed
  time.
- The app starts and goes to the background with less work. It reads the saved data of the active
  server first, and it does not save a server again when nothing changed.
