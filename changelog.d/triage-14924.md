### Fixed

- On Windows, a new revision of an installed skill now replaces the old one when a security tool holds
  the agent's skill folder. Before, the update failed with "EPERM: operation not permitted, rename"
  and the agent kept the old revision.
