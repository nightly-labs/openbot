### Fixed

- On a hosted server that runs on a virtual server, Storage now shows the correct free space of the
  plan. Before, it showed about 5 to 10 GB more free space than the plan had left. The server measures
  the files of its user, at most each 10 minutes. The server must also be on the new version.
- The agents of a hosted server no longer get a wrong size for the system part of the disk.
