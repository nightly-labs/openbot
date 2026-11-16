### Fixed

- The Gemini usage list shows the Gemini 4 Argon limit, also when it is spent. Agents on Gemini 4 Argon
  now show that their limit is reached and wait for the reset, as for other models. Before, OpenBot
  did not find the Argon limit, so the usage list showed only the other Gemini limits, which still had
  room.
