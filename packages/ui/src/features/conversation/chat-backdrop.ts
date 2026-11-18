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

/** A saved backdrop choice: a built-in scene, or `custom:<id>` of a backdrop that the user added. */
export type ChatBackdropChoice = ChatBackdropScene | `custom:${string}`;

export function isChatBackdropChoice(value: unknown): value is ChatBackdropChoice {
  if (isChatBackdropScene(value)) return true;
  return typeof value === "string" && value.startsWith(CUSTOM_PREFIX) && value.length > CUSTOM_PREFIX.length;
}

export function customBackdropChoice(id: string): ChatBackdropChoice {
  return `custom:${id}`;
}

/** The id of a backdrop that the user added, or null for a built-in scene. */
export function customBackdropId(choice: ChatBackdropChoice): string | null {
  return choice.startsWith(CUSTOM_PREFIX) ? choice.slice(CUSTOM_PREFIX.length) : null;
}

const messageMarkdown = new Marked();

function isCodeToken(token: Token): token is Tokens.Code {
  return token.type === "code";
}

/**
 * The first fenced HTML block of a message, as the page that the chat shows for it. An agent often
 * draws a scene this way. The page keeps the policy of the chat preview, so behind the window it
 * also runs no script and sends no request to a server.
 */
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

/** The scenes live in `@openbot/brand`, so mobile draws the same ones. */
export {
  CHAT_BACKDROP_BASE,
  CHAT_BACKDROP_SCENES,
  type ChatBackdropFrame,
  type ChatBackdropScene,
  isChatBackdropScene,
} from "@openbot/brand/chat-backdrop-scenes";

/** How much of the scene the base color covers where the chat usually is (right of the sidebar). */
const CALM_CENTER = 0.55;

/** Paints one frame of the scene on its base color, quieter where the messages of a chat usually are. */
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
  // The base color again, over the middle, makes the scene quieter there.
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
