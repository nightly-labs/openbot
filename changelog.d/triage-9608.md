### Fixed

- When a Gemini sign-in, or another sign-in of an agent provider, cannot reach the provider's server,
  for example because of a DNS problem, it now tells you to check the network connection and the
  DNS settings of the computer that runs OpenBot. Before, it showed only the provider's technical
  error, such as "lookup … server misbehaving".
