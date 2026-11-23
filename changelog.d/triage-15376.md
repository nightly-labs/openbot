### Fixed

- On Windows, **Duplicate agent** no longer fails with a file permission error when the agent folder holds linked folders (for example, installed packages), or when Windows security or search scans the new copy. The copy now keeps linked folders, and OpenBot waits a moment and tries again when Windows holds the new files.
