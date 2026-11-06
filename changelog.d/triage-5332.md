### Added

- Choose what each custom provider model can read beside text: Images, and PDF on OpenCode. A Pi model with Images selected now gets the images that you attach and the images that the agent reads. Before, a Pi custom model got text only, and the agent answered that the model does not support images. An OpenCode model with PDF selected can read PDF files. You can also clear Images for an OpenCode model whose endpoint refuses images.
- Find models now fills the context window, the max output and the accepted inputs of each custom provider model when the endpoint lists them, as OpenRouter, vLLM and gateways in the models.dev format do. A value that you typed or saved stays. A line under the list tells you which values come from the endpoint.
