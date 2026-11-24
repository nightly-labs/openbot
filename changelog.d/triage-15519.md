### Fixed

- An agent no longer stays on "Opening webpage…" for hours when a page never finishes loading. After 30 seconds the agent gets the page that loaded, or an error, and continues. Routine runs and messages in the queue then start as usual. The server must also be on the new version.
