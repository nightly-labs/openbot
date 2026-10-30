### Fixed

- Cursor and other ACP agents no longer ask you to sign in again after a timeout, a network failure or a server error during start while you are still signed in. Only a real sign-out, such as an "Authentication required" answer or `401 Unauthorized`, asks for sign-in. The log now keeps the text of the agent's answer.
