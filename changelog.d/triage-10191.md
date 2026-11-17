### Fixed

- The Claude CLI installs with less free disk space. Before, a disk with about 500 to 850 MB free
  passed the space check, then filled during the install, and OpenBot showed only "OpenBot could not
  update the Claude CLI. Try again." on each try. When a disk fills during the download or the
  install of a provider CLI, OpenBot now says that there is not enough free disk space.
