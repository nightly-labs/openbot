### Fixed

- A ChatGPT agent now always uses the reasoning effort that you chose for it. Before, when your
  Codex settings had a different effort, for example `none`, a chat that OpenBot started or reloaded
  used that effort until the next message. So the compaction of a full chat could fail at once with
  an "Unsupported value: 'none'" error, for example on GPT-6.1-Sol.
