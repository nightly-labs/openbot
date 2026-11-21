import type { PluginGuide } from "./plugin-guide";

export const BULKPUBLISH_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "See your channels",
      text: "The list_channels tool lists the social media channels that are connected to your BulkPublish workspace, and says whether you may create, publish or approve posts. The get_channel_options tool gives the choices of one channel, such as Pinterest boards and YouTube playlists.",
    },
    {
      title: "Draft, schedule and publish posts",
      text: "The create_post tool makes a draft or schedules a post for a date, with different text and media for each network if you want. The get_queue_slot tool gives the next free time in your queue. The publish_post tool publishes a post now, and retry_post sends a failed post again. The update_post tool changes a draft, scheduled or failed post. The delete_post tool removes a post from BulkPublish, and a published post stays live on the networks.",
    },
    {
      title: "Add media",
      text: "The upload_media tool puts an image or video into your media library, and list_media lists the files that are there. For a large file, create_media_upload gives a one-time upload link and finalize_media_upload adds the uploaded file to the library.",
    },
    {
      title: "Read analytics",
      text: "The get_post tool shows the status of a post on each network, get_post_metrics gives the numbers of one post, and get_analytics, get_engagement_analytics and get_account_analytics give the totals of a period.",
    },
    {
      title: "Answer the Inbox",
      text: "The list_conversations and get_conversation tools read direct messages, reviews and comment threads, and reply_to_conversation answers one. The list_post_comments, reply_to_comment and moderate_comment tools work with the comments on your posts.",
    },
    {
      title: "Approvals and repeats",
      text: "The approve_post and reject_post tools decide on the posts that wait for approval. The list_schedules and update_schedule tools read and change posts that repeat on a schedule.",
    },
  ],
  faq: [
    {
      question: "Is the BulkPublish MCP server official?",
      answer:
        "Yes. BulkPublish runs the MCP server at mcp.bulkpublish.com/mcp and documents the setup for each AI app on bulkpublish.com/integrations.",
    },
    {
      question: "How do I connect BulkPublish?",
      answer:
        "Sign in to your BulkPublish account through the browser. OpenBot keeps the token in encrypted storage. The plugin catalog holds no secret.",
    },
    {
      question: "Does BulkPublish cost anything?",
      answer:
        "BulkPublish has a free plan, and paid plans raise the limits on channels, posts and API requests. The pricing page lists the plans.",
    },
    {
      question: "Can an agent publish without asking?",
      answer:
        "The publish_post tool publishes a post immediately, and reply_to_conversation sends a reply at once. Whether the agent asks first depends on its permission mode in OpenBot, so review each post and reply before you approve it.",
    },
    {
      question: "What data does BulkPublish get?",
      answer:
        "BulkPublish gets the requests that the agent sends: the text and media of your posts, your replies, and the questions about your channels. BulkPublish stores your posts and media. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    { label: "BulkPublish: AI integrations", url: "https://www.bulkpublish.com/integrations/" },
    { label: "BulkPublish: API reference", url: "https://app.bulkpublish.com/docs" },
    { label: "BulkPublish: Plans", url: "https://www.bulkpublish.com/pricing/" },
    { label: "BulkPublish: Privacy policy", url: "https://www.bulkpublish.com/privacy/" },
  ],
  checkedAt: "2026-11-20",
};
