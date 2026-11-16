### Fixed

- A ChatGPT agent can look at a large photo again. Before, with Codex CLI 0.167 or later, a photo
  file over about 6 MB did not reach the agent: it said "Code Mode session output limit reached" and
  could not see the photo. Agents now get the photo in a smaller size, turned upright.
