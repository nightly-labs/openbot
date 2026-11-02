### Changed

- The Version line of a provider in Settings says if the CLI is the one that you installed or the
  one that OpenBot downloaded, also when that CLI fails.

### Fixed

- A provider CLI update could fail with "OpenBot could not activate the managed CLI." when you
  also installed the CLI yourself, as for OpenCode. The update checked your CLI in place of the new
  version, and showed its version or its failure as a failure of the update. The update now checks
  the new version. When the new version does not start, the error says so.
