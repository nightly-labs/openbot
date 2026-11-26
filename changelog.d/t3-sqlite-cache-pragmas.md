### Changed

- OpenBot keeps up to 64 MB of its database in memory, not about 2 MB. A large database, such as on a server with many agents, reads less from the disk and stalls less. A server must be on this version to get the gain.
