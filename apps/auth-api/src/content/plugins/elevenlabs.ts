import type { PluginGuide } from "./plugin-guide";

// Every statement about ElevenLabs here is taken from elevenlabs.io. Each page used is in
// `sources`. Check the sources again, and move `checkedAt`, whenever this file changes.

export const ELEVENLABS_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Turn text into speech",
      text: "The agent generates speech from text with an ElevenLabs voice. The audio comes back as a short-lived download link.",
    },
    {
      title: "Build and change voice agents",
      text: "The agent creates, updates, compares and duplicates ElevenLabs voice agents, and changes their system prompt, voice, language and first message. A change through the MCP server is published at once; it does not go to a draft.",
    },
    {
      title: "Review conversations and tests",
      text: "The agent reads conversations and transcripts of your voice agents, and creates, runs and reviews their tests.",
    },
  ],
  faq: [
    {
      question: "Is the ElevenLabs MCP server official?",
      answer:
        "Yes. ElevenLabs hosts the MCP server at api.elevenlabs.io/v1/mcp. ElevenLabs deprecated its local MCP server and archived its repository.",
    },
    {
      question: "Does the ElevenLabs plugin need an API key?",
      answer:
        "No. You sign in to your own ElevenLabs account in the browser and allow access. OpenBot keeps the tokens in encrypted storage and adds the Authorization header. The agent does not see your password.",
    },
    {
      question: "Does it cost anything?",
      answer: "Installing the plugin is free. Speech and other generations use credits of your ElevenLabs account.",
    },
    {
      question: "What does ElevenLabs receive?",
      answer:
        "ElevenLabs gets the text and the requests that the agent sends to it. Your workspaces, conversations and files stay on the computer that runs OpenBot.",
    },
  ],
  sources: [
    {
      label: "ElevenLabs: Hosted MCP server",
      url: "https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp",
    },
    {
      label: "ElevenLabs: Changelog, local MCP server deprecated",
      url: "https://elevenlabs.io/docs/changelog/2026/8/22",
    },
  ],
  checkedAt: "2026-11-06",
};
