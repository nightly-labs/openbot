### Added

- Keep a channel input pending when the provider has not confirmed its receipt. A late turn-start or completion event cannot mark that input accepted or complete, and a Compact refusal keeps its original queued input. Independent audience targets retain their own input and task state.

- Confirm a pending channel input from an exact live receipt on its own loaded execution session. Keep Stop intent and wait for receipt persistence before applying turn completion. Foreign, mismatched or already-ended turn activity cannot claim the input.
