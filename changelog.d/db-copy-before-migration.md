### Added

- Copy your data before an update changes its format. OpenBot keeps the newest two copies in the
  `openbot-db-copies` folder next to `openbot.db`, so you can go back to the version before an update.
  When the disk has too little free space, the database is larger than 4 GB, or the copy fails,
  OpenBot starts as before without a copy.
