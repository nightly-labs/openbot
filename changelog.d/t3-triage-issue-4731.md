### Fixed

- Adding a skill with the name of one of OpenBot's own skills, such as `openbot-data` or `openbot-skill-creator`, failed on every agent with "did not change" and "An unmanaged skill already exists". OpenBot already gives every agent these skills. The local skill library now refuses a skill with such a name and no longer lists one that it took before. If an install still meets one, it gives a clear reason.
