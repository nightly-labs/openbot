### Fixed

- A workflow condition or model step that fails now says why and what to do: the model did not answer
  in time, it tried to use a tool, the model is not available, the provider is busy or cannot be
  reached, or the provider sign-in expired. Before, each of these showed "The model could not answer.
  Run the step again.", and running the step again failed the same way. On a joined server, the
  server must also be on this version.
