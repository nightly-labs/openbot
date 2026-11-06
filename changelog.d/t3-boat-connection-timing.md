### Changed

- A hosted server that was asleep connects sooner after you open it. The server starts OpenBot sooner, publishes itself to the account service right after it signs in, and the app connects as soon as the server is ready instead of at its next check.
- A hosted server runs OpenBot from its AppImage file, not from more than 1,000 unpacked files. After a wake, the host restores one file instead of each file of the app, so the server is ready about half a minute sooner. A server that an older release installed changes to the AppImage at its next update check.
- After a wake, a hosted server checks its providers with a longer time limit while its disk is restored, and looks for provider updates after the restore. Before, a provider that worked could show that the computer was busy.
- The installed app uses about 150 MB less disk space: it no longer includes the source maps of its dependencies.

### Fixed

- A hosted server that went to sleep after a wake now closes OpenBot cleanly. Before, OpenBot stopped with its database still open, and the next start checked the whole database first, which made it slower.
- A hosted server that wakes while its disk is still busy no longer fails to start at the keyring step. Before, that start stopped and began again about 46 seconds later.
