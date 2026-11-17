### Fixed

- Windows: keep your agents and your sign-in when another app, such as Claude Desktop from the
  Microsoft Store, opens OpenBot. Before, Windows saved the data of that start in the other app's
  folder, and OpenBot opened from the Start menu looked signed out and empty. Now OpenBot starts again
  outside that app and uses its usual data folder. Data that an earlier start saved in the other app's
  folder stays there.
