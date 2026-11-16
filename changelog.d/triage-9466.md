### Fixed

- An agent that drags a slider or draws on a canvas in the browser now gets a correct result. Before,
  the drag worked on the page, but the agent got an error, and it could try again and move the slider
  again or draw an extra stroke. On a joined server, the server must also be on the new version.
