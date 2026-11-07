### Changed

- Grok agents send smaller requests. OpenBot turns off the Grok turn summary, an extra request after
  each turn that OpenBot does not show, and Grok no longer loads the skills in `~/.claude/skills`.
  With one developer's skills, each request is about 2,800 tokens smaller.
- OpenBot now keeps the Grok settings in your `~/.grok/config.toml`. A value that you set there for
  feedback, workflows, the turn summary or Claude skills applies to OpenBot agents too.
