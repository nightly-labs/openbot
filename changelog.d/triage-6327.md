### Fixed

- After an update of a provider such as Pi, OpenBot ran its own copy instead of the CLI that you
  installed. A launcher of yours, such as one that picks a Pi profile with its own models, then did
  not run, and those models were gone. The Runtime section of the provider now has "Use installed
  version" to run your own CLI again, and "Use OpenBot's version" to go back.
