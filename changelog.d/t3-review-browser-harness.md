### Added

- Agents can do many browser actions in one step, such as typing a search, pressing Enter, and waiting for results, or paging through a list until they find an item. This uses fewer tokens, because the agent does them in one call and reads the page once at the end. You can still take control of the tab at any time.

### Changed

- Agents find and use OpenBot tools in fewer steps, so browser tasks finish sooner and use fewer tokens.
