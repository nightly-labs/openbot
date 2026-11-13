### Fixed

- ChatGPT (Codex) starts again on a computer with root certificates that Codex cannot read, such as
  the GOST certificates that Russian e-signature programs install on Windows. Before, since 0.68.0,
  Codex stopped at each start with "workspace routing discovery failed", and its agents did not
  answer. A joined server must also be on this version.
