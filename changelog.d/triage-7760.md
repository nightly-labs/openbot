### Fixed

- An agent that reads a skill now gets its JSON examples exactly as written. Before, a long number in
  an example, such as a 19-digit ID, came back with other last digits, and the spaces in the example
  were removed. A JSON example that holds a secret is still hidden.
