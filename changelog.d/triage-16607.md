### Fixed

- A voice conversation with Open microphone no longer sends words that nobody said, such as "E aí" or "Thank you.", when the room is quiet or has only noise. Dictation no longer types them either. Before a Whisper model (local or Groq) writes a recording as text, OpenBot now checks the recording for speech, and a recording with no speech is not sent or uploaded.
