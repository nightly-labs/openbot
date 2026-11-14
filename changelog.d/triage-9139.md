### Fixed

- Codex agents on GPT-6 and other code-mode models can use MCP tools again when the Codex that you
  installed is only the `codex` program without its helper files. Before, each MCP tool failed with
  "failed to spawn code-mode host". OpenBot now uses its own complete Codex in this case.
