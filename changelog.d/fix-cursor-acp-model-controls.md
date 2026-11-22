### Fixed

- Cursor models list both speeds. Composer and Grok no longer arrive only as the fast variant, and each model can be set to fast or standard.
- The effort control of a Cursor model lists every reasoning level Cursor offers for that model, including DeepSeek. Before, discovery sent a parameterized model id as one value and the control showed medium only.
- A Cursor agent no longer ends with "Cursor stopped responding" after five minutes of silence between chunks while tools run or the CLI waits on Cursor's API. The Cursor driver uses a thirty-minute stall limit.
