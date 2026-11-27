### Fixed

- When the channel lead's model reached its usage limit while it routed a message, and the lead had no backup model, every channel showed only "The channel lead could not route this message." The channel now says that the lead's model reached its usage limit, and tells you to choose a member or another model for the lead. This happened, for example, when a Gemini quota was reached. On a joined server, the server must also have this version.
