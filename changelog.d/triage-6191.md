### Fixed

- On macOS, a Pi, Inception, DeepSeek or OpenRouter agent with "Workspace only" access can now use
  Apple apps and other MCP apps that start with `npx` or a similar command. Before, the app test
  passed, but the agent found none of the app's tools, because the sandbox stopped the app from
  writing its files outside the workspace.
