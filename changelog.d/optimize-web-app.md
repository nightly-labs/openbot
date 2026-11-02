### Fixed

- The live view of a remote host's browser tab now shows the full page and puts each click where
  you point. Before, on a page larger than 1280 by 800, the picture filled only the top left of the
  view and the pointer moved away from the target towards the bottom right.
- The live view of a remote browser tab now stays close to the pointer on a busy page. Before, the
  host sent every pointer move to the page, so the page could fall a second or more behind, and a
  click waited for all of the moves before it.
