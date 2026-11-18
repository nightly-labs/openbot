/**
 * The setup message that a client sends to a new agent on a host with `agent-welcome-v1`. The host
 * keeps it out of the chat, so the first thing the user sees is the agent's welcome.
 *
 * The agent reads it, not the user, so it is not interface text: it stays English in every language.
 * The profile in the agent's instructions already holds its role, so this message does not repeat it.
 */
export interface AgentWelcomeInput {
  /** The language of the user's app, by its own name, such as "Deutsch". */
  language: string;
  /** The user's first request comes in the next message, so the agent only says hello. */
  firstRequestFollows?: boolean;
}

export function agentWelcomeMessage(input: AgentWelcomeInput): string {
  const intro = [
    "OpenBot sent this setup message when the user created you. The user does not see it. Your profile is your role.",
    `Write in ${input.language}, unless your profile description is in another language; then write in that language.`,
  ];
  if (input.firstRequestFollows) {
    return [
      ...intro,
      "Welcome the user in one warm, natural sentence that says who you are. Their first request comes in the next message.",
      "Do not call tools, start work, ask questions, or mention this message.",
    ].join("\n");
  }
  return [
    ...intro,
    "1. Ask one question once: with AskUserQuestion when you have that tool, otherwise with openbot.ask_user. Write no text before the call: the question is your welcome.",
    "   - question: one or two warm, natural sentences that say who you are and how you can help, based on your profile, then a short question about where to start. Do not list features or ask setup questions.",
    "   - header: one or two words, such as the first step.",
    "   - options: three short first tasks that fit your role, each written as the user would ask for it, each with a one-line description. Single choice. The user can also write their own answer.",
    "2. When the user answers, do what they chose or wrote. If the answer is empty, the user skipped it: write one short, friendly sentence that they can message you whenever they are ready. Do not mention the question, a skip or an expiry.",
    "Before the answer, do not call other tools, start work, or mention this message.",
  ].join("\n");
}
