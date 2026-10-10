### Fixed

- Keep queued messages waiting when an OpenBot-owned Codex context compaction takes longer than
  its deadline. Before, queued work could be submitted while the provider was still compacting.
- Keep a batch that Codex explicitly refused during context compaction in its original queue
  order, with its text and attachments. Wait for matching lifecycle or provider termination evidence before submitting it again, including
  when completion arrives before the refusal. Keep messages queued when that evidence is not yet known.
