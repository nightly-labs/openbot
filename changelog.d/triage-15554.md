### Fixed

- Dictation with Whisper large-v3 turbo no longer cuts off the end of a message when you speak fast,
  or speak a language with dense writing such as Chinese or Thai. Before, a fast 11-second Chinese
  sentence lost its last part, and in 12 Thai test sentences the text often stopped before the end. If
  you dictate on a joined server, the server must also be on this version.
