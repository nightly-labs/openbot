### Fixed

- When Grok does not start because the `allowed_models` setting in its config does not include its
  default model, OpenBot now says so, and says how to correct it. Before, a Grok update showed only
  "The new version did not start.", and the real reason was only in the log.
