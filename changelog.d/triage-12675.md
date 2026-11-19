### Fixed

- When the main process freezes for much longer than an earlier freeze, OpenBot now records why in
  `logs/stall-profiles.ndjson`, also within 6 hours of the earlier record. Each line in
  `logs/resources.ndjson` also shows the memory of the main process and its limit.
