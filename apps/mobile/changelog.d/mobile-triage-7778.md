### Fixed

- Show only models that can take dictation in the Dictation list of a voice server. Before, the list
  also showed OpenAI realtime models such as `gpt-live-transcribe`, and dictation with them stopped
  with "HTTP 404". When a voice server cannot transcribe with the chosen model, the message now tells
  you to choose a different dictation model.
