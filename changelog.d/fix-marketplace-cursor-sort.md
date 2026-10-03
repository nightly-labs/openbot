### Fixed

- The skill marketplace no longer skips skills when a client pages with a cursor from before cursor
  v1. That cursor held only a timestamp. The catalog order also leads with the featured flag, so the
  timestamp could not say where the last page stopped. The page now comes again and the rest of the
  catalog follows.