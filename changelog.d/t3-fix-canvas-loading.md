### Fixed

- Open the Workflows canvas faster, mostly on a joined server. The canvas now gets the workflow, its
  runs and its versions together with the workflow list, in one round trip. When you open the canvas
  again, it shows the last workflow at once and then gets the latest version. The app starts to load
  the canvas when the pointer comes to the Workflows button. The canvas does not scan the Library
  when it opens: it reads the Library pictures only when a step needs them.

### Changed

- Several people can now edit one workflow at the same time. The canvas merges the edits of the
  other people into your canvas as they save. It does not load the workflow again, it does not move
  the view, and it does not show a conflict message. When two people change the same field, the last
  save wins. A change to a step keeps that step when another person deletes it. Undo takes back only
  your own changes.
- The app keeps the workflows that you opened in memory, for each server. A switch to a workflow that
  you opened before shows it at once, and then gets the latest version.
