### Changed

- `openbot login` on a self-hosted or Docker server now says that the code has 8 characters and when
  it expires. An empty answer asks again. After an expired code, too many wrong codes, or three
  wrong codes, it offers to send a new code. Before, it asked again for a code that could not work,
  and stopped after three answers, an empty one included.
