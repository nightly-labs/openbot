import {
  CHAT_BACKDROP_BASE,
  type ChatBackdropFrame,
  type ChatBackdropScene,
  isChatBackdropScene,
  paintChatBackdropScene,
} from "@openbot/brand/chat-backdrop-scenes";
import { chatHtmlPreviewDocument, chatPreviewKind } from "@openbot/contracts/chat-preview";
import type { AppTextKey } from "@openbot/i18n";
import { Marked, type Token, type Tokens } from "marked";

const CUSTOM_PREFIX = "custom:";

export type ChatBackdropChoice = ChatBackdropScene | `custom:${string}`;

export function isChatBackdropChoice(value: unknown): value is ChatBackdropChoice {
  if (isChatBackdropScene(value)) return true;
  return typeof value === "string" && value.startsWith(CUSTOM_PREFIX) && value.length > CUSTOM_PREFIX.length;
}

export function customBackdropChoice(id: string): ChatBackdropChoice {
  return `custom:${id}`;
}

export function customBackdropId(choice: ChatBackdropChoice): string | null {
  return choice.startsWith(CUSTOM_PREFIX) ? choice.slice(CUSTOM_PREFIX.length) : null;
}

const messageMarkdown = new Marked();

function isCodeToken(token: Token): token is Tokens.Code {
  return token.type === "code";
}

export function messageHtmlBackdropPage(markdown: string): string | null {
  const blocks: string[] = [];
  void messageMarkdown.walkTokens(messageMarkdown.lexer(markdown), (token) => {
    if (isCodeToken(token) && chatPreviewKind(token.lang) === "html") blocks.push(token.text);
  });
  const html = blocks[0];
  return html === undefined ? null : chatHtmlPreviewDocument(html);
}

export const CHAT_BACKDROP_LABEL = {
  pond: "settings.chatBackdrop.pond",
  jellyfish: "settings.chatBackdrop.jellyfish",
  sunset: "settings.chatBackdrop.sunset",
  snowfall: "settings.chatBackdrop.snowfall",
  fireflies: "settings.chatBackdrop.fireflies",
} as const satisfies Record<ChatBackdropScene, AppTextKey>;

export {
  CHAT_BACKDROP_BASE,
  CHAT_BACKDROP_SCENES,
  type ChatBackdropFrame,
  type ChatBackdropScene,
  isChatBackdropScene,
} from "@openbot/brand/chat-backdrop-scenes";

const CALM_CENTER = 0.55;

export function paintChatBackdrop(context: CanvasRenderingContext2D, frame: ChatBackdropFrame): void {
  paintChatBackdropScene(
    {
      fill(x, y, width, height, color, alpha) {
        context.globalAlpha = alpha;
        context.fillStyle = color;
        context.fillRect(x, y, width, height);
      },
    },
    frame,
  );
  const base = CHAT_BACKDROP_BASE[frame.scene][frame.dark ? "dark" : "light"];
  context.globalAlpha = CALM_CENTER;
  const calm = context.createLinearGradient(0, 0, frame.width, 0);
  calm.addColorStop(0, `${base}00`);
  calm.addColorStop(0.3, `${base}00`);
  calm.addColorStop(0.62, base);
  calm.addColorStop(0.9, `${base}00`);
  calm.addColorStop(1, `${base}00`);
  context.fillStyle = calm;
  context.fillRect(0, 0, frame.width, frame.height);
  context.globalAlpha = 1;
}
