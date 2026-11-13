### Fixed

- An agent that reads a skill now gets each JSON example exactly as written, when the example has no
  secret in it. Before, a long number in an example, such as a 19-digit ID, came back with other last
  digits, and the spaces in the example were removed. An example that holds a secret, or a field
  such as `token` or `apiKey`, still has that value hidden.
