### Changed

- When the main process freezes for 2 seconds or more in two minutes in a row, OpenBot now records which of its functions used the time. The summary stays in `logs/stall-profiles.ndjson`, and its five heaviest functions go out as one analytics event, at most once in 6 hours. It holds function names only, with no paths or data of the user.
