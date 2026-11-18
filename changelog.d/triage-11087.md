### Fixed

- A Gemini (Antigravity) agent no longer shows a tool call that the model wrote as text, such as
  `call:default_api:run_command{...}`, as its answer. The call did not run. The chat now says that
  Gemini ended the turn with no answer and that you can send the message again. An agent with a
  backup model moves to it, as after other turns with no answer. On a joined server, the server must
  also be on this version.
