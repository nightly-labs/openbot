### Changed

- Use less CPU and memory while channel agents write replies. Before, OpenBot read the whole
  conversation and the whole channel history again about ten times each second for each agent.
- Close the Computer Use highlight windows one minute after no agent controls the computer. Before,
  they used memory for as long as Computer Use was on.
