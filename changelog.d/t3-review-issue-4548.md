### Fixed

- After an agent submits a form in the browser, such as a booking, it reads the page again before it
  reports the result. Before, an agent could say that a booking failed when the page showed that it
  was done, because a separate list did not update yet.
