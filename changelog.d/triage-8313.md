### Fixed

- When a sign-in field is in a frame from another address of the same site, as the Apple sign-in in
  App Store Connect is, an agent now learns that the field is in a frame and asks you to sign in
  with browser takeover. Before, the agent got "Element is no longer attached to the document" and
  tried other ways to fill the saved Vault login first.
