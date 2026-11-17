### Fixed

- The OpenBot database no longer grows with each Codex and Claude turn that OpenBot imports from the
  provider history. Before, OpenBot kept a full copy of each imported item. Now it keeps only a hash
  of the item. After the upgrade, OpenBot also does this for the items that it imported before, in
  small steps after start. The database file keeps its size, but OpenBot uses the free space again
  before the file grows.
