### Fixed

- Codex agents no longer say that image generation is unavailable when an `exec` cell does not list the image tool in `ALL_TOOLS`. The image tool is a direct tool that `exec` does not list, and the agent instructions now say so.
