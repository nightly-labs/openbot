### Fixed

- Messages to Hermes agents no longer fail with "Hermes request timed out: session/set_config_option"
  when Hermes is slow. OpenBot now sends the model and the effort to Hermes only when they change.
  When an agent does not answer a settings change in time, the chat says so in plain words.
