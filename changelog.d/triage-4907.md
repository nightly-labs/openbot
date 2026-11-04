### Fixed

- A Marketplace agent update no longer fails when one of its skills has local changes. Before, the
  update stopped with "This skill has local changes" and the agent stayed on the old version. Now
  the update asks about each changed skill that gets a new version: keep your changes, or replace them
  with the new version.
  A host that updates an agent for a joined server keeps the changed skills.
