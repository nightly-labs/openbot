## Cursor agents

- A Cursor agent no longer ends with "Cursor stopped responding" after five minutes of silence between chunks while tools run or the CLI waits on Cursor's API. The Cursor driver uses a thirty-minute stall limit instead of the default five minutes.