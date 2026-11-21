### Fixed

- When OpenCode or another agent provider did not answer while OpenBot opened a chat, OpenBot ended
  the provider, but the log did not say which step it waited for. The log now names the step, so a
  bug report shows where the provider stopped.
