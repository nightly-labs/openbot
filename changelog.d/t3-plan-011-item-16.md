### Fixed

- On a Mac with a Host Manager, OpenBot stops its own update check and download when the Host Manager
  takes over the updates. Before, a download that was already running continued, and its progress
  could replace the host's update state in Settings > Updates until the next status check.
