### Fixed

- A browser script that returns a list named `elements` now gives the agent its result. Before,
  the script ran its steps but the agent got only the error "element.states is not iterable", and
  it could run the same steps again.
