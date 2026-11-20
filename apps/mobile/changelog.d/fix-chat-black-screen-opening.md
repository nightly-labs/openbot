### Fixed

- Opening a bot with an existing conversation could leave the message list black until the reader scrolled. The list could report ready before the rows arrived, so the chat waited for a placement that never came. The chat now clears that stale state when rows arrive, and scrolls to the latest message on every platform if the list does not report ready in time.
