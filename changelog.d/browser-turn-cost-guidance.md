### Changed

- Agents finish browser tasks with fewer tool calls: they do the steps that they already know in one browser script and do not read the page again to confirm what the script returned. On our browser tasks, this uses about 18% fewer tokens.
