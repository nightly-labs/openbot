### Fixed

- A workflow model step or condition that the provider refuses now says what to do and why. It no
  longer always says "The model could not answer. Run the step again." when a new run cannot help.
  The step tells you when the account has no credit or its plan does not include the model, when the
  provider does not permit the model, blocks the input, or does not accept the step, and when the
  input is too long. For another refusal, the step says what to do first and then shows the
  provider's reason, with secrets removed. On a joined server, the server must also be on this
  version. An app on an older version shows these new texts in English.
- A long error on a failed workflow step was cut after three lines, and you could not read the rest.
  Now "Show more" opens the full error, and "Show less" closes it.
