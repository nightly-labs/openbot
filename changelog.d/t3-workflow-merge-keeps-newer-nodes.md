### Fixed

- A workflow with steps from a newer OpenBot could lose those steps. When another member or an agent changed the workflow while your change waited to save, OpenBot merged the two and saved the steps that it could not read as locked notes. Now it does not save a workflow that it shows as read-only, and the server refuses a save that turns a step into a locked note.
