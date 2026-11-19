### Fixed

- In a workflow, the "Next run" row of a schedule trigger says "After run N ends" while an older run
  of the workflow has not ended, for example a run that waits for an approval. Before, it showed the
  planned time, also when that time was in the past, and did not say why no new run started.
