### Changed

- Agent browser tabs find bot checks, such as a Cloudflare "Just a moment..." page. When the check
  passes by itself, the agent waits for it, for up to 15 seconds. When the check needs a person, the
  agent asks you to take control or reports it, and does not try to solve it or load the page again.
- An agent browser snapshot waits up to 2 seconds while the page shows loading placeholders. Before,
  the agent read the placeholders and had to look at the page again.
- An agent that opens a browser tab gets the page with it, and the first browser result brings the
  other browser tools. A short browser task now often takes 1 or 2 steps instead of 3 or 4.
- Agent browser scripts accept more wait forms that models write, such as `sleep(500)` or
  `waitFor({ target, state: "visible" })`. Before, these scripts failed and the agent tried again.

### Fixed

- When the page in an agent browser tab crashes, the next browser step loads the page again, and a
  running browser script stops at once. Before, the tab stayed broken, and the script waited until
  its step timed out.
