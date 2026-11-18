### Fixed

- When a Claude account reached its usage limit while background helpers of an agent worked, the
  helpers stopped and the agent gave an empty reply. It did not move to its backup model. Now the work
  continues on the backup model with the helpers' results, or continues when the limit ends. On a
  joined server, the server must also be on this version.
