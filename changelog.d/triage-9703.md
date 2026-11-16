### Fixed

- On a KDE Plasma Wayland desktop, an agent now tells you in plain words that it cannot type or click in other
  apps there, and that it can still read windows and take screenshots. Before, it tried again and again and showed
  driver error codes such as "foreground_unavailable". The Computer Use driver does not send keys or clicks to a
  chosen window on this desktop. A joined server must also be on the new version.
