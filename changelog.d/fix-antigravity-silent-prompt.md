### Fixed

- A Gemini message no longer shows "thinking" without end when Gemini sends nothing back. Before,
  you had to stop the message and send it again, sometimes more than once. Now OpenBot sends it
  again by itself after 3 minutes with no reply. If Gemini is silent again, OpenBot ends the message
  with an error, and you can send it again.
