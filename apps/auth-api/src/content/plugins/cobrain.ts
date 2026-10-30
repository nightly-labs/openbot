import type { PluginGuide } from "./plugin-guide";

// Every statement about Cobrain here is taken from cobrain.space. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const COBRAIN_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Start work with a briefing",
      text: "The start_session tool gives a briefing for one unit, such as a client or a project. It has the rules, the index card, instructions, lessons, the latest decisions, open sub-units and the last fifteen changes. The load_context tool loads a full folder or tag in one call.",
    },
    {
      title: "Find past decisions",
      text: "The search tool finds text in your brain and in brains that people share with you. On the Pro and Team plans, it also finds notes with the same meaning in other words. The find_notes tool finds a note by its name or path, and resolves a [[wikilink]].",
    },
    {
      title: "Save what the agent learned",
      text: "The append_file tool adds text to the end of a note. The patch_file tool replaces one exact passage. The write_file tool replaces a full note, but it does not replace a long note with a much shorter one until you confirm.",
    },
    {
      title: "Keep the brain in order",
      text: "The create_unit tool makes a unit from a template, with an index card and a decision log. The move_file tool renames or moves notes and folders. The dream_tidy_up tool finds duplicates, long decision logs and dead links, and helps the agent fix them with you.",
    },
  ],
  faq: [
    {
      question: "Does the Cobrain MCP server need an API key?",
      answer:
        "No. You sign in with your Cobrain account. Cobrain shows what OpenBot can read and write before you approve, and then gives an OAuth grant that expires and renews itself. OpenBot keeps the tokens in encrypted storage. You can revoke the connection on the Cobrain Connections page.",
    },
    {
      question: "What can an agent do in my Cobrain brain?",
      answer:
        "A connected agent has the same permissions as you. It can read what you can read and write where you can write. Cobrain records each change that an AI makes and keeps earlier versions. A deleted note goes to the trash for 30 days, and the AI cannot see the trash.",
    },
    {
      question: "Where does Cobrain keep my notes?",
      answer:
        "Cobrain encrypts note text, versions and attachments with a key for each brain, held in AWS KMS. The data is in Ireland. Names, paths, tags and dates stay readable. Cobrain says this is not end-to-end encryption. Your OpenBot workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
    {
      question: "Does Cobrain cost anything?",
      answer:
        "Cobrain has a free plan with up to 1,000 notes and no card. Pro costs $9 a month and adds unlimited notes and search by meaning. Team costs $7 per seat a month and gives a company brain that is separate from your personal brain.",
    },
  ],
  sources: [
    { label: "Cobrain", url: "https://cobrain.space/" },
    { label: "Cobrain: tools for your AI", url: "https://cobrain.space/guides/tools" },
    {
      label: "Cobrain: permissions and privacy",
      url: "https://cobrain.space/shared-memory/permissions-and-privacy",
    },
    { label: "Cobrain: pricing", url: "https://cobrain.space/pricing" },
  ],
  checkedAt: "2026-10-23",
};
