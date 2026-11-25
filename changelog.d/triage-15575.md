### Fixed

- When an agent downloads a file in the OpenBot browser, it now gets the saved path in its next browser step, from any tab. Before, the agent saw the path only in its next snapshot of the same tab, so it often looked in the wrong folder and told you that the download did not save. Browser downloads go to the `OpenBot/Downloads` folder, not to your `Downloads` folder.
