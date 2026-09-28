### Fixed

- On Linux and macOS, OpenBot finds a provider CLI that you installed yourself, such as OpenCode under
  nvm, when your shell profile prints text at start. Before, a greeting or a tool such as `fastfetch`
  in `.bashrc` or `.zshrc` made OpenBot show the provider as not downloaded. MCP server commands had
  the same fault.
