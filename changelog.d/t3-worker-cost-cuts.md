### Changed

- Open the home page, `/app` and `/app-preview` faster. The account service keeps one copy of each
  page per language and release, and does not render the page again for each visitor.
- Answer a request for a missing web app file at once with "not found", without a full page.
