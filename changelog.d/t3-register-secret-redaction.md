### Security

- OpenBot now hides the API key and the header values of a custom endpoint in logs, error messages and OpenCode output, also when the key has no known format.
- OpenBot now hides a short password or a one-time code that it fills from 1Password, as it does for the Vault, Bitwarden and Proton Pass.
- The browser no longer records the console messages of a page after a password fill, until the page changes.

### Fixed

- A Pi agent reply no longer shows "•••" in place of the value of a public header of a custom endpoint, such as `Content-Type`, `HTTP-Referer` or `X-Title`. The values of all other headers stay hidden.
