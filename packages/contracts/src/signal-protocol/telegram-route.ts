export const TELEGRAM_ROUTE_AUDIENCE = "openbot-telegram-route";

export const TELEGRAM_UPDATES_PATH = "/v1/telegram/updates";
export const TELEGRAM_FILES_PATH = "/v1/telegram/files";
export const TELEGRAM_UPLOADS_PATH = "/v1/telegram/uploads";

export const TELEGRAM_CAPABILITY = "telegram";

export const TELEGRAM_ROUTE_TTL_SECONDS = 5 * 60;

export const TELEGRAM_ROUTE_CHATS_LIMIT = 64;

export const TELEGRAM_UPDATE_BYTES_LIMIT = 64 * 1024;

export const TELEGRAM_FILE_BYTES_LIMIT = 20 * 1024 * 1024;

export const TELEGRAM_TEXT_LIMIT = 32_000;

export const TELEGRAM_FILE_TOKEN_TTL_SECONDS = 2 * 60;

export const TELEGRAM_LINK_CODE_TTL_SECONDS = 15 * 60;

export const TELEGRAM_LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/u;

export const TELEGRAM_CHAT_ID_PATTERN = /^-?[0-9]{1,20}$/u;

export const TELEGRAM_BOT_ID_PATTERN = /^[0-9]{1,20}$/u;

export interface TelegramRouteClaims {
  aud: typeof TELEGRAM_ROUTE_AUDIENCE;
  hid: string;
  chats: TelegramRouteChat[];
  iat: number;
  exp: number;
}

export interface TelegramRouteChat {
  id: string;
  botId: string;
  linkedAt: number;
}

export function telegramRouteChatKey(chat: TelegramRouteChat): string {
  return `${chat.botId}:${chat.id}:${chat.linkedAt}`;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineButton[][];
}

export interface TelegramReplyParameters {
  message_id: number;
  allow_sending_without_reply?: boolean;
}

export interface TelegramCallParams {
  getMe: Record<string, never>;
  sendMessage: {
    chat_id: number;
    text: string;
    parse_mode?: "HTML";
    message_thread_id?: number;
    reply_parameters?: TelegramReplyParameters;
    reply_markup?: TelegramInlineKeyboard;
    link_preview_options?: { is_disabled: true };
  };
  editMessageText: {
    chat_id: number;
    message_id: number;
    text: string;
    parse_mode?: "HTML";
    reply_markup?: TelegramInlineKeyboard;
    link_preview_options?: { is_disabled: true };
  };
  deleteMessage: { chat_id: number; message_id: number };
  setMessageReaction: {
    chat_id: number;
    message_id: number;
    reaction: Array<{ type: "emoji"; emoji: string }>;
  };
  answerCallbackQuery: { callback_query_id: string; text?: string; show_alert?: boolean };
  leaveChat: { chat_id: number };
  getFile: { chat_id: number; file_id: string };
  sendDocument: {
    chat_id: number;
    file_name: string;
    message_thread_id?: number;
    reply_parameters?: TelegramReplyParameters;
  };
}

export type TelegramCallMethod = keyof TelegramCallParams;

export const TELEGRAM_CALL_METHODS = [
  "getMe",
  "sendMessage",
  "editMessageText",
  "deleteMessage",
  "setMessageReaction",
  "answerCallbackQuery",
  "leaveChat",
  "getFile",
  "sendDocument",
] as const satisfies readonly TelegramCallMethod[];

export interface TelegramCallResult {
  messageId?: number;
  botId?: string;
  username?: string;
  fileToken?: string;
  fileSize?: number;
  uploadToken?: string;
}

export interface TelegramCallFailure {
  errorCode: number;
  description: string;
  retryAfter?: number;
}

export type TelegramUploadAnswer = { ok: true; messageId: number } | ({ ok: false } & TelegramCallFailure);
