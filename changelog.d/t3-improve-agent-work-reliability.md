### Changed

- Agents finish more of a task before they stop. They wait in the same turn for a build or deploy of up to about 15 minutes, try other ways when a step fails, do work that their own tools cover instead of passing it to a teammate first, and finish the rest of a task when a teammate returns only part of it. Before, an agent often stopped with an unchecked deploy or with a teammate's partial result, and the user had to tell it to continue.
