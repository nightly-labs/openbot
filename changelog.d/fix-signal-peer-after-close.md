### Fixed

- Closing a remote connection while Signal checks its ticket no longer uses one of the account's
  remote connection slots. Before, the closed connection kept its slot, and the desktop was told
  that a phone was ready. A later device was then refused because the account was full.