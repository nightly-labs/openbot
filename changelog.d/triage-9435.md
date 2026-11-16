### Fixed

- A Grok agent now follows its own access setting in OpenBot, also when your Grok or Claude Code
  settings set a different permission mode. Before, a `dontAsk` mode in those settings made Grok
  refuse OpenBot's tools, such as the browser tabs and teammate messages, with "denied by prompt
  policy", and an always-approve mode let an Ask first agent run tools without asking (#9435). A
  joined server needs this version too.
