### Fixed

- On macOS and Linux, you can now delete an agent whose folder has a read-only folder in it, for example a Go module cache that the agent made. Before, the delete failed with "The agent data could not be removed completely. Retry deleting the agent.", and each retry failed in the same way. OpenBot now gives you write access to the folders that it deletes with the agent, then removes them. It does not change other files or folders, and it does not follow links out of these folders. On a joined server, the server must also be on this version.
