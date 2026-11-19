### Fixed

- Show the Gemini 4 Argon limit of a Google AI Pro plan in the Gemini usage list, and stop an agent
  on Gemini 4 Argon when that limit is spent. Before, OpenBot did not get the Argon limit from Google,
  so agents on Argon failed with a quota error while the usage showed room. On a joined server, the
  server must also be on this version.
