### Fixed

- A hosted or self-hosted server on a Linux kernel older than 6.1, for example in a Proxmox VE 7
  container, can open network connections again after an update. Before, the AppArmor profile that
  the update loads blocked each socket (#4335).
