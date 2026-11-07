### Changed

- Hermes agents use fewer tokens in each request: about 2,400 fewer (16%). The Hermes browser tools
  are off, because each agent has its own OpenBot browser. In a code workspace, agents see only the
  names of Hermes skills that are not about code, and can still use them. Your own
  `coding_context` and `disabled_toolsets` settings in the Hermes `config.yaml` still apply.
