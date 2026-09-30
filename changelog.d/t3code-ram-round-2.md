### Fixed

- The Dynamic Island shows new messages again when you have more than 10,000 unread replies. Before, it stopped updating, and OpenBot logged an error each time the island changed.
- Each Dynamic Island window uses about half the memory. Before, each window loaded the full app. There is one window for each display.
- OpenBot keeps at most 16 chats in memory that you only read. Before, each chat that you marked read stayed in memory until you quit, about 1 MB for a long chat.
