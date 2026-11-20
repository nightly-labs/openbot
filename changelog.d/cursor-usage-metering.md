### Fixed

- Cursor agent Usage now records tokens when the CLI sends `usage`, `_meta.usage`, or token counts on
  `usage_update` (under `_meta`), and explains when per-turn metering is unavailable instead of showing
  empty totals as missing usage. A joined server needs this host version for the change.