### Fixed

- The **Custom** tab of the model picker no longer says that the models of your endpoints load
  after the current task, when no task holds them. When the provider read your endpoints but lists
  none of their models, the tab now says so and gives an **Edit endpoints** button. For example,
  OpenCode leaves out each provider that `enabled_providers` in your own OpenCode config does not
  name.
