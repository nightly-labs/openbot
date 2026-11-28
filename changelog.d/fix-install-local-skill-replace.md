### Fixed

- An agent that cannot update a skill because its files have local changes now tells you how to replace them: in Skills, open the menu of the skill, select Repair, then Replace skill. This installs the newest version of the skill and discards the local changes. Before, the install said "Confirm replacement to continue", but the agent had no way to confirm. After the agent saved a new version of the skill, OpenBot told the agent to do the same install again. On a joined server, the server must also be on this version.
