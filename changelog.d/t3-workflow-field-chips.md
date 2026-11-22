### Changed

- Workflows: a step prompt, task, question or message shows each `{{name}}` field as a chip. Backspace removes a whole chip. A chip for a field that has a problem, for example a field that not every path gives, has the warning color and shows the problem when you point to it. The saved text stays `{{name}}`, so copy, paste and older versions work as before.
- Workflows: the field list that opens after `{{` shows the step icon of each field, makes the typed letters bold, puts fields that start with the typed text first, and shows "No matches" when no field agrees with the text.
- Workflows: a single `{` also opens the field list, and the field you pick is saved as `{{name}}`. After a single `{`, the list closes when no field matches, and Enter adds a new line until you type a letter or use the arrow keys, so JSON and code in a prompt stay easy to type.
