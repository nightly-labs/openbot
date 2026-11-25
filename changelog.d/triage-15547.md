### Fixed

- OpenCode: when the model writes its actions as text and does not do them, the reply now fails with
  a plain message that tells you to try again or choose another model. Before, the reply looked
  complete, and a routine run showed "Succeeded" although the work was not done.
