### Fixed

- Sites that check for bots no longer find the built-in browser as easily. Before, a tab in the
  background or in a minimized window reported a window smaller than its page, `window.chrome` was
  empty and frames had none, and a tab that was not shown kept a fixed 1200x800 page size.
- Agents now type short text one key at a time with real key codes, and move the pointer along a
  short path and hold the button when they click. Before, text arrived with no key events and the
  pointer jumped to the target with no hold. Clicks in a tab that is not shown take no longer than
  before.
