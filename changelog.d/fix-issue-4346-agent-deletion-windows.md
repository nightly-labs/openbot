### Fixed

- Delete an agent on Windows without requiring an app restart. Before, deleting an agent often failed with "The agent data could not be removed completely" because provider session locks in the workspace directory were not released until OpenBot quit.
