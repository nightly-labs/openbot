### Fixed

- An OpenCode subagent that works in the background no longer shows "Working" with a timer that
  never stops after OpenCode stops reporting on it. Before, the card stayed so until OpenBot started
  again. Now OpenBot keeps the chat's OpenCode session open while the subagent still reports work, and
  the card shows "Stopped" when the session closes.
