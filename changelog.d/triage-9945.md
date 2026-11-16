### Fixed

- On a slow or busy computer, Pi, OpenRouter, DeepSeek and Inception could show "Error" in Settings > Providers while their sign-in said "Connected", with "Pi request timed out: get_state" under Diagnostics. The provider worked, but the check did not wait long enough for Pi to start. OpenBot now waits for Pi to start, and shows an error only when a second, longer read of the models also fails. On a joined server, the server must also be on the new version.
