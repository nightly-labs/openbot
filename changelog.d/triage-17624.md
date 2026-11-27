### Fixed

- Custom agents that run the Gemini (Antigravity) CLI, such as `agy acp`, can now use all the tools of
  their MCP apps. Before, the CLI left out the largest tools, and a call to one of them failed with
  "is not enabled for server".
