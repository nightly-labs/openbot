### Changed

- A hosted server that was asleep connects sooner after you open it. The server starts OpenBot sooner, publishes itself to the account service right after it signs in, and the app connects as soon as the server is ready instead of at its next check.
- After a wake, a hosted server checks its providers with a longer time limit while its disk is restored, and looks for provider updates after the restore. Before, a provider that worked could show that the computer was busy.
- A hosted server no longer saves its npm download cache when it goes to sleep, so a wake restores less data.
- A new hosted server no longer installs Hermes and Cursor by itself when OpenBot starts. To use them, select Download on their provider row. Before, each server saved about 3 GB of these CLIs, and each wake restored them.
- The installed app uses about 150 MB less disk space: it no longer includes the source maps of its dependencies.

### Fixed

- A hosted server that went to sleep after a wake now closes OpenBot cleanly. Before, OpenBot stopped with its database still open, and the next start checked the whole database first, which made it slower.
