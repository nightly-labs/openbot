### Added

- A hosted server updates itself. It downloads a new OpenBot release in the background and starts it at its next start, so an open session does not stop. A server that was set up before this release needs one manual upgrade, as `docs/hosted-servers.md` says.

### Changed

- A plan change no longer stops a hosted server that is in use. The server moves to the machine of the new plan when it has no use for 7 minutes, or at its next start.
