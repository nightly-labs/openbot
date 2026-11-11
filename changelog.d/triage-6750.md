### Fixed

- On Windows, installing or updating a skill for an agent no longer fails when antivirus or the search indexer opens the new skill files for a moment. Before, the install stopped with an "operation not permitted" error, and a temporary `.openbot-stage-` folder stayed in the agent's skills folder, where the agent could load it as a second copy of the skill. Now OpenBot waits up to about 3 seconds and tries again. When the install still fails, it deletes the temporary folder.
