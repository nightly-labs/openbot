### Fixed

- A file chip with only a file name, such as `main.log`, now finds a file that a Claude or Codex agent read with a shell command (`cat`, `tail`, `sed -n`) in the same thread, also outside its workspace. Before, the chip failed with "Nothing exists at main.log in the agent workspace".
