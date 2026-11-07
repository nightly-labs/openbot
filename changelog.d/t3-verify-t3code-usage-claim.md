### Changed

- Claude agents use fewer tokens in each request: about 4,000 fewer (24%) without your Claude Code
  setup, and about 2,000 fewer (12%) with it. Claude Code skills that cannot work in OpenBot, such as
  `schedule`, `loop` and `send-to-project`, are off. Coding skills such as `code-review` and
  `claude-api` stay available, but agents see only their names. Remote Control tools are off, and
  so are the Claude Code tools and helper agents for the Claude Code app, such as its review panel and
  status line setup.
- Commits and pull requests that Claude agents make no longer add a Claude co-author line. With
  your Claude Code setup on, your own `attribution` and `skillOverrides` settings still apply, and
  your own skills keep their listing.
