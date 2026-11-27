### Fixed

- The desktop app no longer stops responding for some seconds every few minutes while a Claude or Codex agent works. Before, OpenBot started a separate provider process to read the plan usage every few minutes, also when the running turn had just reported the same usage. On Windows, starting that process can block the window for 2 to 7 seconds.
