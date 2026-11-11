### Fixed

- Install a new revision of a local skill when the installed copy has no unsaved edits. Before, the
  install stopped with "This skill has local changes" when the folder had a macOS `.DS_Store` file,
  when the agent saved the revision from its installed copy and the description had a colon, or when
  the files matched a newer saved revision. A copy with real edits is still kept until you replace it.
  For agents on a joined server, the server must also be on the new version.
