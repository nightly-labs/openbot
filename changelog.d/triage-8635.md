### Fixed

- On Windows, an OpenCode agent can attach files from its folder and the Shared folder to its
  answer. Before, the attachment often failed with "ENOENT from lstat", also when the file was there.
  If a path is still wrong, the error now tells the agent how to write it again.
