### Fixed

- A channel now routes messages when its lead uses a Pi model from a Pi extension, such as
  `claude-code/claude-opus-5-5`. Before, each message failed with "Routing failed. Choose a member
  or try again." Channel summaries, memory reviews and profile texts with such a model work again
  too.
