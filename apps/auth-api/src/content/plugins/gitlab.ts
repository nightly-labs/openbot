import type { PluginGuide } from "./plugin-guide";

// Every statement about GitLab here is taken from docs.gitlab.com. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const GITLAB_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Review merge requests",
      text: "The agent lists merge requests with list_merge_requests and reads one with get_merge_request. It can leave a review with save_merge_request_review, open or update a merge request with save_merge_request, and merge it with accept_merge_request.",
    },
    {
      title: "Work with issues",
      text: "GitLab keeps issues as work items. The agent finds them with list_work_items, reads one with get_work_item, and creates or updates one with save_work_item. It adds a comment with save_note.",
    },
    {
      title: "Read the code",
      text: "The agent reads a file with get_repository_file, walks the tree with list_repository_tree, and reads history with list_commits and get_commit. It can also create a branch and add a commit.",
    },
    {
      title: "Check CI pipelines",
      text: "The agent lists pipelines with list_pipelines, reads one with get_pipeline, and reads a job with get_job. Use this to find out why the last pipeline failed.",
    },
  ],
  faq: [
    {
      question: "Is the GitLab MCP server official?",
      answer:
        "Yes. GitLab builds the server into GitLab itself, at /api/v4/mcp. It is generally available on the Free, Premium and Ultimate tiers, on GitLab.com, GitLab Self-Managed and GitLab Dedicated.",
    },
    {
      question: "Does the GitLab plugin need a personal access token?",
      answer:
        "No. Each user signs in to their own GitLab account through the browser. OpenBot registers itself with GitLab, does the sign-in, keeps the tokens in encrypted storage, and adds the Authorization header. The plugin catalog holds no secret.",
    },
    {
      question: "Does it work with a self-hosted GitLab?",
      answer:
        "Yes, but not from this listing, which connects to GitLab.com. Add an MCP server with your GitLab address followed by /api/v4/mcp in the MCP servers settings, and sign in there. On GitLab Self-Managed, an administrator must allow access to the MCP server for the instance.",
    },
    {
      question: "What data does GitLab get?",
      answer:
        "Your workspaces, conversations and files stay on the computer that runs OpenBot. GitLab gets the requests that the agent sends, such as a search query or a merge request update. The tools work on the groups and projects that your GitLab account can access.",
    },
  ],
  sources: [
    { label: "GitLab: MCP server", url: "https://docs.gitlab.com/user/model_context_protocol/mcp_server/" },
    {
      label: "GitLab: MCP server tools",
      url: "https://docs.gitlab.com/user/model_context_protocol/mcp_server_tools/",
    },
  ],
  checkedAt: "2026-11-06",
};
