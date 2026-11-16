### Fixed

- On a cloud server or a self-hosted server that updated to 0.71.0 from an older version, each
  command of a Claude agent with Workspace only access still failed with "apply-seccomp: ... caller
  must provide CAP_SYS_ADMIN". The server now adds the AppArmor rule for the Claude sandbox each time
  OpenBot starts, not only at a new install. The server must also be on the new version.
- On Linux, a Claude agent with Workspace only access now tells you when the computer does not let
  Claude start its sandbox, and asks you to choose Full access or another provider. Before, each
  command failed with a technical `apply-seccomp` error and the app did not say what to do.
