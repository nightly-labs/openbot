### Fixed

- A workflow model step or condition that the provider refuses now says why and what to do. It no
  longer always says "The model could not answer. Run the step again." when a new run cannot help.
  The step tells you when the account has no credit or its plan does not permit the model, when the
  provider does not permit the model, blocks the input, or does not accept the step, and when the
  input is too long. For another refusal, the step shows the provider's reason, with secrets
  removed. On a joined server, the server must also be on this version.
