### Fixed

- OpenBot stops Codex, OpenCode, Grok or a custom agent when it sends one message larger than 128 MB, and shows the reason. Before, OpenBot kept all of the message in memory with no limit, and the system could stop OpenBot on a hosted server.
