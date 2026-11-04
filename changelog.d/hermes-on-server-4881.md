### Fixed

- Let Hermes Agent install on a self-hosted server and in the Docker image. Before, its installer
  stopped because the server had no `libatomic1`, and the service user cannot install packages.
  The server guide now tells how to install Hermes for the OpenBot service user.
