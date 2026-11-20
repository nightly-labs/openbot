### Fixed

- Show the Claude sign-in when the Claude CLI is slow to check its sign-in. Before, OpenBot stopped
  the check after 5 seconds, showed "Claude did not answer in time" each time, and never asked you
  to sign in. Now it waits up to 20 seconds.
