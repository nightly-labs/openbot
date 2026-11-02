### Fixed

- Pi agents now show a compaction that Pi runs by itself in the context meter, and wait until the context grows 5% past the post-compaction fill before compacting again. Before, OpenBot did not see Pi's own compaction and could ask for another one at the same fill.
