### Changed

- The preview of a text or Markdown file shows the whole file. Before, it stopped after 200,000
  characters. The Markdown view loads the next part as you scroll, and the code view shows a long
  file in parts, with buttons to go to the previous or next part.
- In the preview of a Markdown file, a code block of more than 25 lines scrolls inside its box.

### Fixed

- A link to a file in an agent's message, such as `[file](/path/report.md)`, is a file chip that
  opens the file, as on desktop. Before, the link was plain text that did nothing. A file that the
  message attaches and also links shows only as the chip, not again as a card above the message.
- A large Markdown file with long code blocks, such as a crash report with stack traces, opens in the
  preview. Before, the app closed when it opened the file.
