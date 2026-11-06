### Fixed

- Keep the database small when a channel member streams a long message. Before, each update of
  the message wrote a full copy of it to the event history, so a long thought added gigabytes.
  Messages from before this update keep their earlier copies.
