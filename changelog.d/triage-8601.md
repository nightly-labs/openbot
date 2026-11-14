### Fixed

- Compact context in a channel's settings compacts the members that can compact on request, such as
  Codex members, also after a restart or after some minutes with no answer. Before, it failed with
  "No member of this channel can compact its context now" in every channel. When no member can
  compact, the message now says why: no member has a conversation in the channel yet, or the members
  compact their context automatically. On a joined server, the server must also be on this version.
