### Fixed

- A chat that is almost full no longer compacts again and again when the provider retries failed requests. Before, each turn compacted the chat, the agent did no work, and only a restart stopped it. When 2 compactions in a row do not make a chat smaller, OpenBot now shows "Compaction does not make this chat smaller" and stops compacting it automatically.
