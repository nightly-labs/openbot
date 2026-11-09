### Fixed

- Agents make fewer failed browser calls. The browser tools now take more of the argument forms that
  agents write from other browser libraries, such as a ref or a CSS selector as a plain string,
  `wait_for` states such as `networkidle`, and `tab_id`. A browser script can wait with a function
  that reads the page, and it can read a whole page in one `evaluate` step.
