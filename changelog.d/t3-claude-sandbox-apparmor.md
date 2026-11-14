### Fixed

- On a cloud server or a self-hosted server with Ubuntu 26.04, each command of a Claude agent with "Workspace only" failed with "apply-seccomp: ... caller must provide CAP_SYS_ADMIN". The server now adds one AppArmor rule for `bwrap`, and `openbot uninstall` removes it. The server must also be on the new version.
