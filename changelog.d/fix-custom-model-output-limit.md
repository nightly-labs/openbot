### Fixed

- A custom model whose output limit follows a small context window, such as a 16K-token window, can
  run a turn again. OpenCode 2.2.5 read OpenBot's `output: 0` marker as unknown and asked the
  endpoint for a fixed 32,000 output tokens, which such a model refused before the first token. The
  model now gets an output budget of half its context window, no more than 32,000.

### Added

- A per-model output limit for a custom endpoint, next to the context window. Half the window is a
  guess: a 128K-window model with a 16K output cap — the shape that produced this report — still
  got a 32,000-token budget from the guess, so the endpoint settings now take the model's real
  output limit and write that into the OpenCode entry. Leave the field blank to keep the guess.
  A model whose window was already saved also changes what it sends with a blank cap: the fixed
  half-window budget replaces the runtime's own pick (OpenCode 2.1.1 gave a 32,768-window model
  about 21,071 tokens; it now sends 16,384) — smaller and predictable, and the new field covers a
  model that needs more.
