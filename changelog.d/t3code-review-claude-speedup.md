### Changed

- A long reply that streams does less work for each new part. Only the end of the text is read
  again, the code in a code block is colored one new line at a time, and lines that did not change
  are not drawn again. The line that is still arriving has no color until it is complete. Before,
  each new part read and colored the full reply again.
