### Fixed

- In a long chat, OpenBot became slower each time an agent started a new part of a reply, because it
  read all earlier streamed replies of the chat to save the new text. The window could lag or stop
  for a moment while agents worked. OpenBot now saves streamed text at the same speed in a long chat
  as in a new one.
