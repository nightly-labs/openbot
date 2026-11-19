### Changed

- Each workflow step now keeps the settings that it ran with (prompt, model, size and the other
  fields) and the inputs that it read, for a full run, for "Run step" and for a retry. Before, a
  result did not keep these, and a retry used the step as it is now. Results from older versions
  have no saved settings. After this update, an older version of OpenBot cannot open your data.
