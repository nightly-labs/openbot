### Fixed

- A custom provider now accepts a model ID that has `@` or other punctuation, such as the
  `@cf/openai/gpt-oss-120b` models of Cloudflare Workers AI. Before, the form refused these IDs, so
  you could not use these models. For a custom provider on a joined server, the server must also be
  on the new version.
