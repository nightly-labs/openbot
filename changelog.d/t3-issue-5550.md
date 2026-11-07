### Fixed

- Claude agents on an Anthropic API key now use the key's promotional API credit. Before, Anthropic counted their requests as Claude Code, which promotional credit can leave out, so a key with only such credit failed with "Credit balance is too low".
- When a Claude agent uses an Anthropic API key that has no API credit, OpenBot now says that the key has no credit, that a Claude plan does not pay for API key requests, and how to use the Claude plan. Before, it showed only "Credit balance is too low".

### Changed

- The Anthropic API key settings now say that Anthropic bills the key's API credit, not your Claude plan.
- In the model menu, the Anthropic API key account has a key badge in place of a number, so you can see it apart from your Claude sign-in.
