### Fixed

- A message to a Gemini agent no longer fails with "Unknown model ID" when Gemini could not load its models from Google for a moment. Before, the message failed with only that text, also for a model that the list showed and that worked for the next message. Now OpenBot opens the Gemini session again. When Gemini still has no models, the chat says "Gemini could not load its models. Send your message again." On a joined server, the server must also be on this version.
