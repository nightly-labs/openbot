### Fixed

- On Windows, you can delete a custom agent (an agent that you added with its own command) while
  another custom agent works. Before, the delete failed with "Work of another agent still uses this
  agent's folder", also when you asked an agent to delete it, and the agent often stayed in the list.
