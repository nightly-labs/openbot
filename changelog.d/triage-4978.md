### Fixed

- When `OPENBOT_ANTIGRAVITY_PATH` names a Gemini server file that is missing or not executable,
  OpenBot now says so and tells you to correct the path or remove the variable. Before, it said
  that Gemini was not downloaded and told you to download it, but Download refused while the
  variable was set.
