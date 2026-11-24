### Fixed

- A file link in chat no longer opens a different file that only has the same name. Before, a link such as `other-repo/skills/thumbnails/SKILL.md` could open another `SKILL.md` that the agent read before. Now a link with folders opens a file only when its folders agree. When no file agrees, OpenBot tells you that the file was not found. A link with only a file name works as before. On a joined server, the server must also be on the new version.
