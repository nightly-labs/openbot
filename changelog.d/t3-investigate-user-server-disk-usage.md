### Changed

- The storage card of a hosted server now measures the storage of its plan, such as 50 GB for
  Standard. The system and the preinstalled tools of the server are not counted. The card shows
  when less than 10 GB of the plan is free, for example at 40 GB used of 50 GB. On Starter (12 GB),
  it shows when less than 20% of the plan is free. Before, it measured the full disk of the server
  and showed only when less than 5 GB of the disk was free. In the desktop app, Server settings >
  Storage shows the same free space.
- Agents on a hosted server now know the storage of its plan. They check the space before a large
  download, build or container, and remove what they no longer need.
