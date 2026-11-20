### Fixed

- On Windows, when another program still uses an agent's folder, for example a program that the
  agent started, a delete of that agent now says so: close that program or restart the computer that
  the agent runs on, then delete the agent again. Before, it said "The agent data could not be
  removed completely. Retry deleting the agent.", and a retry failed in the same way. An agent that
  cannot delete another agent is now also told not to delete the agent's folder or files another way.
