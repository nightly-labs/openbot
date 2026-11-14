### Fixed

- When an agent reads a video that has captions, such as a YouTube video, it now gets the full
  transcript from the captions. Before, agents got no transcript for videos longer than about
  100 minutes, and only the first 30 minutes of shorter videos. When the agent asks only for the
  text, OpenBot no longer downloads the video. For a long video without captions, the agent is
  told that the video is too long, not that it has no sound.
