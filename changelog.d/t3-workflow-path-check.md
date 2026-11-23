### Changed

- A workflow step now shows a problem when it uses an answer field that some paths into it do not give, such as the other branch of a condition, another trigger or the first pass of a loop. Mark the field optional (`name?`) or give it on every path. It also shows a problem when two steps before it can give the same field in the same run. Agents cannot add these problems with `edit_workflow`. Saved workflows run as before.
