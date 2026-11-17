### Fixed

- Download a provider CLI again by itself when its copy fails the check at start. Before, when a file
  in a downloaded CLI changed, such as Pi 1.5.2, the provider showed "not installed" until you clicked
  Download in Settings. On a joined server, the server must also be on this version.
