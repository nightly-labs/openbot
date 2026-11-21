### Fixed

- A custom agent that starts slowly, such as Kiro CLI on Windows, could show no models, with the
  error "Kiro request timed out: model/list". When OpenBot started the agent to read its models, it
  opened two test sessions, one after the other, in the same 30 s limit. OpenBot now uses the models
  from the first session, so the models of a slow agent show again. On a joined server, the server
  must also be on the new version.
