### Fixed

- Dictation on the desktop now uses a model that knows your language before you choose one in
  Settings > Voice. Before, it always used Parakeet, which knows only 25 European languages, so speech
  in Korean, Japanese, Chinese, Arabic and other languages came out as wrong words. When the app or the
  computer uses one of these languages, dictation now uses Whisper large-v3 turbo. The first dictation
  downloads it (about 1 GB), also when Parakeet is already on the computer. To keep Parakeet, select
  it in Settings > Voice. A model that you selected before stays as it is.
