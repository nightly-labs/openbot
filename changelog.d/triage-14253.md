### Fixed

- Tell the user when a provider refuses the saved API key or sign-in and the agent moves to its
  backup model. Before, the agent moved without a reason, went back to the refused key every 10
  minutes and failed again. Now the agent waits longer before each new try, up to one hour, and
  goes back as soon as you replace the key in Settings.
