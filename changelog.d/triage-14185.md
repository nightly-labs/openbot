### Fixed

- A workflow image or video step uses the resolution that an agent set, also when the agent writes
  it in lowercase, such as "2k". Before, the step used the first resolution of the model, often 1K,
  and did not tell you. When the workflow runs on a joined server, the server must also be on the
  new version.
