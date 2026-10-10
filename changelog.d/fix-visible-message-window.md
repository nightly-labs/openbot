### Fixed

- Keep early queued inputs visible when they join a running turn before already loaded replies in a paged conversation. Preserve trusted local visibility through refresh and bounded caches while retaining the existing turn order, canonical pages and cursors.

- Preserve the host canonical order of split-turn pages, including newly visible members, cold reads and page merges.

- Verify local cross-page order from fresh, bounded row keys before merging loaded history. Keep the existing view when a write, scope change, missing row or budget limit prevents a complete proof.

- Count cache growth while a history-order check waits, including retained bodies across a server switch.
