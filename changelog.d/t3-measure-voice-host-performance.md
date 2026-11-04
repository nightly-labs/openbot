### Changed

- Local dictation with Parakeet or Bark and replies read aloud use less memory. After a long turn,
  the dictation process holds about 230 to 500 MB less, and the read-aloud process about 110 MB
  less. Whisper keeps its settings, because they make it faster.
- Local dictation uses up to 6 processor threads on a computer with 12 or more logical
  processors, and 4 on smaller computers. With the memory change, long turns are as fast as
  before or a little faster.
