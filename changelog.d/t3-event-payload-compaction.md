### Fixed

- The OpenBot database uses much less space for chats from older versions. Older versions wrote every
  message of the chat again for each chat update, so the history of a chat held many copies of the
  same messages. After the upgrade, OpenBot removes these copies in small steps after start. Each
  chat stays the same. The database file keeps its size, but OpenBot uses the free space again before
  the file grows.
- After you install this version, you cannot go back to an older OpenBot version on this computer or
  server. An older version does not open the database: the app installs the newest version, and a
  server does not start.
