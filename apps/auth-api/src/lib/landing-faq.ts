// The questions on the landing page. They are also the home page's FAQPage
// JSON-LD, so the questions a search engine reads are the ones the page shows.
// No imports: `site-metadata.ts` reads this, and the build config reads that.

export interface LandingQuestion {
  question: string;
  answer: string;
}

export const LANDING_FAQ: readonly LandingQuestion[] = [
  {
    question: "Is OpenBot free?",
    answer:
      "Yes. OpenBot costs $0, with no locked features. Your agents use the AI plans or API keys you already pay for.",
  },
  {
    question: "Do I need an account?",
    answer: "No. The app works without an account.",
  },
  {
    question: "Which AI models can OpenBot use?",
    answer:
      "Codex, Claude Code, Gemini, Grok, OpenCode, Cursor and Cline. You can also connect any OpenAI-compatible endpoint, and local models in Ollama or LM Studio.",
  },
  {
    question: "Where does my data go?",
    answer:
      "Workspaces, conversations, attachments and browser data stay on the computer that runs OpenBot. The AI provider you choose receives the prompts that your agents send to it, and the pages that agents open use the network.",
  },
  {
    question: "Which computers can run OpenBot?",
    answer:
      "macOS 13 or newer on Apple silicon or Intel, Windows 10 or newer on x64, and Linux on x64 or arm64 as an AppImage.",
  },
  {
    question: "What can agents do on my computer?",
    answer:
      "OpenBot is a development preview. Agents can read and change files, run commands, use the network and control the built-in browser without asking each time. Give them only tasks you trust, and keep backups.",
  },
];

/** schema.org `FAQPage`, from the questions the page shows. */
export const LANDING_FAQ_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: LANDING_FAQ.map((entry) => ({
    "@type": "Question",
    name: entry.question,
    acceptedAnswer: { "@type": "Answer", text: entry.answer },
  })),
};
