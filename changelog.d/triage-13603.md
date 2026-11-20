### Fixed

- When OpenBot starts while another OpenBot uses the same data folder, the new start now writes a
  line to its output and gives the process number of the OpenBot that runs. Before, it stopped
  after a few seconds with no reason, so a server started from a service looked like it crashed.
