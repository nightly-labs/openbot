import { createContext, type PropsWithChildren, useContext } from "react";
import { useCSSVariable } from "uniwind";
import { mixColor } from "@/features/settings/model/message-color";

/**
 * The surface under the messages of a chat while bubbles are solid (Settings › Appearance ›
 * See-through bubbles off): the chat background or the base color of the backdrop. Unset with
 * see-through bubbles, and out of a chat.
 */
const SolidSurfaceContext = createContext<string | undefined>(undefined);

export function ChatSolidSurfaceProvider({ surface, children }: PropsWithChildren<{ surface: string | undefined }>) {
  return <SolidSurfaceContext.Provider value={surface}>{children}</SolidSurfaceContext.Provider>;
}

/**
 * The solid fill of a chat surface that is drawn as the control fill at `share` opacity, such as a
 * card or a table out of a bubble: the same color mixed onto the surface, so a backdrop does not show
 * through it. Undefined with see-through bubbles: the caller keeps its translucent fill.
 */
export function useSolidChatFill(share: number): string | undefined {
  const surface = useContext(SolidSurfaceContext);
  const control = String(useCSSVariable("--openbot-bg-control") ?? "");
  if (surface === undefined) return undefined;
  return mixColor(surface, control, share) ?? control;
}
