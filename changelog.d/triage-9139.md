### Fixed

- Codex agents on GPT-6 and other code-mode models can use MCP tools again when the Codex that you
  installed is only the `codex` program without its helper files. Before, each MCP tool failed with
  "failed to spawn code-mode host". OpenBot now uses its own complete Codex in this case, unless you
  chose to use your installed version. When OpenBot's Codex is not on this computer yet, Settings >
  Providers shows Download on the ChatGPT row. On a joined server, an admin sees the same Download,
  and the server must also be on this version.
