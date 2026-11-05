### Fixed

- Let agents in the Docker image find the programs in `~/.local/bin`, for example a Python that
  `uv` installs. These programs are in the data volume, so they stay after an update. Before, only
  `/data` stayed, and on an instance with an empty data folder agents did not find the programs in
  it.
