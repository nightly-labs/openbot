### Fixed

- Open large channels faster on a joined server. Before, the server read and counted the channel
  history again for each smaller page that it tried, so a channel with long messages took seconds to
  open. The server must also be on this version.
