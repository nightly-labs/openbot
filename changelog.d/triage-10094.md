### Fixed

- A DeepSeek model on a custom endpoint for Mistral's API (`https://api.mistral.ai`) now finishes
  its turn after a tool call. Before, each request after the first command failed with HTTP 422
  "Extra inputs are not permitted". For an agent on a joined server, the server must also be on the
  new version.
