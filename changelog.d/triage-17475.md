### Fixed

- When Claude Code used an Anthropic API key that OpenBot did not set, and the key was not valid, the chat showed only "Invalid API key · Fix external API key". The chat now says that Claude Code uses a key that is not valid in place of your Claude plan, and that you must remove the key from the Claude Code settings or the environment variables, then restart OpenBot.
