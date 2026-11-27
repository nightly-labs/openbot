### Fixed

- When Claude Code used an Anthropic API key that OpenBot did not set, and the key was not valid, the chat showed only "Invalid API key · Fix external API key". The chat now says that the key comes from the Claude Code settings or the environment variables, that Claude Code uses it in place of your Claude plan, and that you must remove it and restart OpenBot to use your plan.
