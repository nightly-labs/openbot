### Fixed

- The OpenBot database no longer grows with each Codex and Claude turn that OpenBot imports from the
  provider history. Before, OpenBot kept a full copy of each imported item. Now it keeps only a hash
  of the item. After the upgrade, OpenBot also does this for the items that it imported before, in
  small steps after start. The database file keeps its size, but OpenBot uses the free space again
  before the file grows.
- After you install this version, you cannot go back to an older OpenBot version on this computer or
  server. An older version cannot read the compacted items, so it does not open the database: the app
  installs the newest version, and a server does not start.
