### Fixed

- The Effort list of an OpenCode model no longer changes when OpenCode is busy. Before, a model that
  OpenCode did not answer for in time got the efforts of a different model, so the Effort box of an
  agent could be empty and its list could change each time the model picker opened. A model now
  keeps the efforts that OpenCode last gave for it. A joined server shows this after it updates.
