### Fixed

- When the processor of a computer cannot run a provider, such as Gemini (Antigravity) on a processor without AES
  or PCLMUL, OpenBot now says that the processor cannot run this provider and that you must use a different
  provider. Before, the row said only "Try again", and each new try failed in the same way. On a joined server,
  the server must also be on the new version.
