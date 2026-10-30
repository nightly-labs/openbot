import type { PluginGuide } from "./plugin-guide";

// Every statement about Hugging Face here is taken from huggingface.co and Hugging Face's
// hf-mcp-server repository. Each page used is in `sources`. Check the sources again, and move
// `checkedAt`, whenever this file changes.

export const HUGGINGFACE_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Find models, datasets and Spaces",
      text: "The hub_repo_search tool searches models, datasets and Spaces on the Hugging Face Hub, one type or all types in one call. The hf_fs tool can also filter by Hub tag, for example to find the fine-tunes or quantized versions of a base model.",
    },
    {
      title: "Inspect a repository or a dataset",
      text: "The hub_repo_details tool gets the details of a model, dataset or Space. For a dataset, it shows the configs, splits, sizes and schema, and a preview of the rows. The hf_fs tool reads files from a repository, such as a model card.",
    },
    {
      title: "Follow papers and trends",
      text: "The hf_fs tool lists trending models, datasets, Spaces and papers, and the latest daily papers. It reads the text and metadata of a paper by its arXiv ID. The agent can tell you which new papers relate to your task.",
    },
    {
      title: "Search the documentation",
      text: "The hf_fs tool searches the Hugging Face documentation with a natural language query. Ask, for example, how to use LoRA adapters with PEFT, and the agent gets the matching pages.",
    },
  ],
  faq: [
    {
      question: "Is the Hugging Face MCP server official?",
      answer:
        "Yes. Hugging Face hosts the MCP server at huggingface.co/mcp and documents it in the Hub documentation. The source code is in Hugging Face's hf-mcp-server repository on GitHub.",
    },
    {
      question: "Does the Hugging Face plugin need an account or a key?",
      answer:
        "No. The OpenBot listing connects with no sign-in. Hugging Face answers requests without a token with its anonymous set of tools. The server tells the agent that anonymous use has rate limits. A Hugging Face account gives higher limits.",
    },
    {
      question: "What can the agent see and change on Hugging Face?",
      answer:
        "The agent reads public Hub data: models, datasets, Spaces, collections, papers and documentation. The anonymous tools only read, so the agent cannot change anything on the Hub. Hugging Face gets the requests that the agent sends. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Can the agent create repositories or run jobs?",
      answer:
        "Not with this listing. Hugging Face says that repository creation, Jobs, dynamic Spaces and sandbox tools need Hugging Face authentication. You turn on these tools on your MCP settings page on Hugging Face.",
    },
  ],
  sources: [
    { label: "Hugging Face: Hugging Face MCP Server", url: "https://huggingface.co/docs/hub/agents-mcp" },
    { label: "Hugging Face: hf-mcp-server repository", url: "https://github.com/huggingface/hf-mcp-server" },
  ],
  checkedAt: "2026-10-26",
};
