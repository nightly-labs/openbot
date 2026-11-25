### Added

- An agent on your own server can now use your free credits for a model that takes them, when the
  server has too few paid credits. The credits card of your server shows your free credits.

### Changed

- When an agent picks no model and the paid credits are too low, it now makes the image or video
  with a model that takes free credits, at settings that fit them. When the agent names a paid model,
  it gets the free model and its settings instead of a request to add credits.
- GPT Image 2.6 is now the first image model, so agents use it when no default is set. Eight older image
  models that have a newer version are no longer offered: ChatGPT Image 2, GPT Image 2.5 Flare and
  Sunburst, Ideogram V3, Nano Banana, Recraft V4, Seedream 4.0 and Seedream 4.5.

### Fixed

- Screen readers now read credit amounts with their unit, such as "4.5 credits". Before, they read
  only the number.
