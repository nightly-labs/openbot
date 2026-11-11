### Fixed

- Agents can click elements from their newest browser snapshot on pages that load content in frames, such as Gmail. Before, a frame that loaded in the background made each click fail with "Stale browser reference", also after a new snapshot.
