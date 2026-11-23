### Fixed

- Compact context in a channel now works while a message in the channel waits for its turn. Before,
  a message that waited for a provider that did not start blocked compaction, and the channel said
  "Wait until the work in this channel stops" for as long as the provider stayed down. When the
  provider of the members does not work, the channel now says so and tells you to refresh the
  providers. On a joined server, the server must also have this version.
