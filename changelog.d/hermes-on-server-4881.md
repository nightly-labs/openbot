### Added

- Add Download to the Hermes Agent row in Providers, on a server and on a Mac or Linux computer.
  OpenBot runs the official Hermes installer, shows its progress, and then shows Connect for the
  Nous Portal code. Windows keeps the install guide.

### Fixed

- Let Hermes Agent install on a self-hosted server and in the Docker image. Before, its installer
  stopped because the server had no `libatomic1`, and the service user cannot install packages.
  The server guide now tells how to install Hermes for the OpenBot service user.
- Show Connect for Hermes Agent, Kimi and GitHub Copilot on a server, in the app and on the
  web. The server signed them in with a code, but only the iPhone app offered it.
