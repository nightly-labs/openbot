### Fixed

- An agent video or picture with OpenBot credits no longer stops at the first short failure of the
  account service. The agent waits for the same job and shows it in the chat with one charge. When
  the agent asks for the same video again after a failure, it gets the first job, not a second
  charge. The server must also be on the new version.
- When the account service could not save a started job, the held credits now come back after
  about 15 minutes. Before, they stayed held for 24 hours.
