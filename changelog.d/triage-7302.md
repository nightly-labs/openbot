### Fixed

- When OpenBot cannot read the answer to an agent's API key form, the form now shows an error and
  stays open. Before, the form closed as answered but saved nothing, and the agent could not find
  the key. This occurred when the key had more than 8,000 characters, or when the "Save for" answer
  was typed in the iPhone app and was not one of the options. On a joined server, the server must
  also be on this version.
