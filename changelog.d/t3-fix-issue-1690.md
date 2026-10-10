### Fixed

- Custom ACP agents can recover from a closed session when you send a new message. Before, messages could repeatedly fail with `Internal error`. Startup errors now show provider details with secrets removed. Recovery keeps the conversation and does not repeat a failed prompt.
