### Added

- Pi, Inception, DeepSeek, OpenRouter and custom ACP agents can search the web with the
  `openbot.web_search` tool. A separate Codex session on the Codex sign-in of this computer runs the
  search and returns a short answer with source URLs. Agents on other providers keep the web search
  of their own CLI.

### Changed

- Codex agents use about 1,050 fewer tokens (about 5%) in each request. Codex no longer offers to
  install ChatGPT plugins, which OpenBot cannot complete, and no longer lists the `openai-docs`,
  `work-pets` and `plugin-management` skills, which are about the Codex app. A `tool_suggest` or
  `[[skills.config]]` setting in your own Codex `config.toml` still applies.
- Titles, profiles and other short background texts that Codex writes use about 1,500 fewer tokens.
