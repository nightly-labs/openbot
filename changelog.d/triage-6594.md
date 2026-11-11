### Fixed

- An agent set to switch to its backup models automatically now switches when its model, such as Grok, gives only its reasoning and no answer before the agent starts to work. The message then runs again on the first available backup model. Before, the turn failed, and the backup models were not used. A turn that already used a tool still does not run again, so a tool does not run two times (#6594).
