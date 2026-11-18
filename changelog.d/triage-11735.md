### Fixed

- Dictation with Whisper large-v3 turbo in Thai no longer writes a word or a phrase again and again,
  and no longer drops Thai letters. Before, many Thai sentences became a repeated word, and letters
  such as the "ก" in "เกิด" were missing. The model now uses a more precise part, so its download size
  in Settings > Voice goes from 988.6 MB to 1.2 GB, and it uses about 270 MB more memory while it
  runs. If you already have the model, OpenBot downloads only the new part (606.7 MB) one time, at
  your next dictation or when you select Download in Settings > Voice, and then deletes the part that
  it replaces. Long Thai sentences can still lose their last words.
