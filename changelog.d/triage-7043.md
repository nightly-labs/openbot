### Fixed

- Read the plan usage less often while a usage limit holds agents. Before, each check of a held limit
  read the usage again, also right after the provider refused a read, so the usage in the sidebar
  could stay out of date for an hour.
