### Fixed

- When `OPENBOT_ANTIGRAVITY_PATH` names a Gemini server that starts but prints a version that
  OpenBot cannot read, such as an old Antigravity CLI, OpenBot now says so. It tells you to set the
  variable to Antigravity CLI 1.5.3 or later, or to remove it. Before, it said only that the version
  cannot be read, and Download was not available while the variable was set (#8161).
