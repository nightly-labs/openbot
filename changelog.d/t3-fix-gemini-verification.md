### Fixed

- When Google must verify a Gemini account, the error now always has a Verify account button. OpenBot
  asks Google for the current verification page, the same page that Antigravity shows when you sign
  in. Before, Antigravity CLI 1.5.14 answers such as "Verification required" showed no button, and
  signing in again in OpenBot did not show this step, so messages continued to fail.
