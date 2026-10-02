### Added

- Restart a provider from its menu in Settings, and restart all custom agents from the Custom agents section. OpenBot waits until no agent of that provider works, then starts the provider again and reads its version, sign-in state and models again. Agents of other providers continue to work, and messages sent during the wait run after the restart.
- Restart OpenBot when no agent works, from Settings > Updates. New routine runs wait until the restart and run after it. When an update is downloaded, the same action installs it.

### Fixed

- A custom agent kept its saved model after a restart. Before, a custom agent that started slowly could move its agents to its default model.
