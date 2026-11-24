### Fixed

- A long answer from a Pi agent with many `{` or `[`, such as an html card with CSS, now stays complete
  on the computer, on the web and in the phone app. Before, the answer stopped after about 1.5 KB with
  `[redacted-unscanned]`, and the html preview was blank. Secrets in the answer are still hidden.
  Answers that were cut before this release stay cut. For an agent on a joined server, the server must
  also be on the new version.
