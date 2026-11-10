### Fixed

- Agents no longer save the same shared database record twice after a slow write. Before, when a write passed its time limit, OpenBot told the agent that nothing was saved, even when the record was saved, so the agent wrote it again. Now the agent is told that the write may be saved and reads the record before it tries again.
