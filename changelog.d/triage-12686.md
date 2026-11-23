### Fixed

- An empty file (0 bytes) no longer attaches as if it were correct. OpenBot now says that the file is
  empty or that it cannot read it, and asks you to save the file again and attach it again. Before,
  the agent got an empty image and said that only PNG and JPEG images can open.
- When an agent opens an empty image, it now learns that the file is empty, not that the image type
  is wrong.
- On a joined server, this check needs the new version on the server too.
