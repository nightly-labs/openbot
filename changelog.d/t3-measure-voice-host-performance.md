### Added

- Settings > Voice offers two more local dictation models. Parakeet Unified EN 0.6B is English
  only, as fast as Parakeet TDT, and writes punctuation. Cohere Transcribe knows 14 languages, and you
  must set the language. It is about three times slower, it is a 2.9 GB download, and it uses about
  4 GB of memory.

### Changed

- Local dictation with Parakeet or Bark and replies read aloud use less memory. After a long turn,
  the dictation process holds about 230 to 500 MB less, and the read-aloud process about 110 MB
  less. Whisper keeps its settings, because they make it faster.
- Local dictation uses half of the logical processors, from 4 to 6 threads: 6 on a computer with
  12 or more, and 4 on a computer with 9 or fewer. With the memory change, long turns are as fast as
  before or a little faster.
- Underdog Bark 3.0 Plus is no longer offered, because Parakeet Unified EN is as fast and makes
  fewer errors. If you use Bark or have downloaded it, it stays in Settings > Voice and continues to
  work.
