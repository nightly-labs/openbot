### Fixed

- When an agent asks for the details of several tools and one name is wrong, it now gets the details
  of the correct tools and the names that it must correct. Before, the full request failed with a
  general error, and the agent often tried the same wrong names again.
