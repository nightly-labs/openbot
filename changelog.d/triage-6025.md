### Fixed

- Workflow conditions and other workflow model steps that use Claude now work when Claude Code
  connects through a gateway, an API key helper, Amazon Bedrock or Google Vertex AI set in its
  settings. Before, these steps failed with "The model could not answer. Run the step again." while
  agent steps worked. Generating an agent profile with Claude had the same problem.
