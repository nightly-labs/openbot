### Changed

- The message input is a pill when it has one line, and gets card corners when the draft grows.
  The queue, the waiting block, the notices and the `@` list come out from behind it, as before.
- The New chat button is no longer in the message input. New chat stays in the context ring.
- The cards above the message input (waiting block, queue, notices, errors) use one row height, one
  text size and one text column, in line with the text in the input. A notice shows its title and
  its text on one line, with smaller buttons, so each notice with short text has the same height.
- The cards above the message input open and close with one movement: a card comes out from behind
  the input and goes back down, and the other cards move with it. Before, most cards closed in one step.
- The queue and the waiting block stay open while the `@` list is open, so the chat does not move
  when you type `@`. The list opens over them.
- The `@` list closes with a short movement. Before, it went away in one step.
- When a notice is the card next to the message input, the round ends of the input show the colour
  of the notice.
- An error shows its reference code on the line of its text, so it has the height of the other notices.
- The empty ring of the waiting block and of the open waits is easier to see.
- A side thread, the side question panel and the Tasks page show their error and reply cards the
  same way: the card comes out from behind the input. The input in the dock chat and in the diagram
  chat is a pill too.
- The input of the dock chat, the diagram chat and the side question panel is 40 px high. Before, it
  was 48 px in some panels.
- The input of the dock chat, the diagram chat, the side question panel, a side thread and the Tasks
  page gets card corners when the draft has more than one line, and moves to its new height. Before,
  it changed height in one step.
- The input of the Tasks page is one row: the agent, the text of the task, then Start. With attached
  files it has card corners, as the message input has.

### Fixed

- Escape in the message input keeps the text cursor. Before, after Escape closed the `@` list, Backspace
  did not delete the `@`.
- The input of the diagram chat grows with a draft of more than one line. Before, the text went
  out of the input.
