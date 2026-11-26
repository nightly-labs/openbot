### Fixed

- After a provider such as OpenCode sends a very large tool update, the next chats and routines on that provider work again. Before, each new turn on that provider, also for other agents, failed at once with the same "Incoming ACP data exceeds the configured byte limit" error until you quit OpenBot. Tool updates up to 256 MB, such as an edit of a large file, also work again: before, updates larger than 32 MB failed. On a joined server, the server must also be on this version.
