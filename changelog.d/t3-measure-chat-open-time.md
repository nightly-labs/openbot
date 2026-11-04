### Fixed

- A channel with a long history opens quickly again. Before, the app read every task of the channel
  again for each task, which kept the computer busy for seconds or minutes after start and after
  each channel message, so the channel took more than 10 seconds to open.
