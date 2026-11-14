### Fixed

- Dictation on the desktop now uses a model that knows your language before you choose one in
  Settings > Voice. Before, it always used Parakeet, which knows only 25 European languages, so speech
  in Korean, Japanese, Chinese, Arabic and other languages came out as wrong words. Now these languages
  use Whisper large-v3 turbo, with your language set. A model that you chose stays as it is.
