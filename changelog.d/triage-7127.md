### Fixed

- When Claude says "You're out of usage credits", an agent that switches to backup models without
  asking now moves to its next ready backup model. Before, the turn failed with this text, and no
  backup model was tried. An agent with no backup model still shows the text. On a joined server,
  the server must also be on the new version.
