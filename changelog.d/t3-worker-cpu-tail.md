### Changed

- Make the first request to a new account service instance faster. The service now prepares its
  routes when it starts, and loads the text of a page language only when a page in that language
  opens. Before, the first page in a new instance loaded the text of all 15 languages.
