### Added

- Choose an existing Hermes profile for each agent on this computer, during creation or in settings.
  Choose the default profile explicitly, or keep the Hermes environment and active profile.
  Profile changes keep the conversation and start a new provider session.

### Fixed

- Stop an explicit Hermes profile's process when shutdown occurs during its model read.
- Use the selected Hermes profile's model availability instead of inherited sign-in state.
  Hide Connect for explicit profiles and for joined-host and public web pickers with no sign-in route.
- Exclude reserved Hermes profile names from discovery and explicit launch.
- Load a saved Hermes profile's models before the first choice from another provider.
- Keep profile discovery within the 4,096-ID response limit, including the default profile.
