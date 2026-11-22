### Fixed

- The first voice conversation now shows that OpenBot is getting the voice ready. While the voice models download, the "Hold to talk" button fills up and shows "Getting ready" with the percent, then turns into the button. Before, the voice bar looked ready during the download, but "Hold to talk" did nothing and nothing showed that a download was in progress.
- A voice model download that stops getting data for one minute now ends with "Could not download the voice model. Try again." Before, it could wait forever, and the voice conversation never started.
