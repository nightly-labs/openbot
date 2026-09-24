/**
 * The link parameters of each agent row on the chat list, with its AppleZoom source. A chat opened
 * with these parameters zooms from the row avatar and back, as a tap on the row does. Rows register
 * while they are mounted, so a row outside the list or scrolled out gives no parameters.
 */
const links = new Map<string, Record<string, string>>();

/** `href` is the link that Link gives its child: the path and the parameters in the query. */
export function registerChatLink(chatId: string, href: string): () => void {
  const params = Object.fromEntries(new URL(href, "https://openbot.run").searchParams);
  links.set(chatId, params);
  return () => {
    if (links.get(chatId) === params) links.delete(chatId);
  };
}

export function chatLinkParams(chatId: string): Record<string, string> | null {
  return links.get(chatId) ?? null;
}
