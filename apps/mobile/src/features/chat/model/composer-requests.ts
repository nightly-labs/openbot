import { create } from "zustand";

/**
 * Text that another screen puts into one agent's composer, such as the skill-creation request from
 * Agent info > Skills. The chat of that agent takes it once, when it is mounted and matches.
 */
export interface ComposerRequest {
  serverId: string;
  agentId: string;
  text: string;
}

type ComposerTarget = Pick<ComposerRequest, "serverId" | "agentId">;

export const useComposerRequest = create<{ request: ComposerRequest | null; focus: ComposerTarget | null }>(() => ({
  request: null,
  focus: null,
}));

export function requestComposerText(request: ComposerRequest): void {
  useComposerRequest.setState({ request });
}

/** Removes and returns the request for this agent, or null when it is for another chat. */
export function takeComposerRequest(serverId: string, agentId: string): string | null {
  const { request } = useComposerRequest.getState();
  if (!request || request.serverId !== serverId || request.agentId !== agentId) return null;
  useComposerRequest.setState({ request: null });
  return request.text;
}

/**
 * Asks that agent's chat to focus its composer and show the keyboard. Send it after the screen that
 * sent the text has gone: iOS gives first responder back to the view it came from when a sheet
 * finishes closing, so a focus during the dismissal is lost.
 */
export function requestComposerFocus(target: ComposerTarget): void {
  useComposerRequest.setState({ focus: target });
}

/** Removes a focus request for this agent and tells whether there was one. */
export function takeComposerFocus(serverId: string, agentId: string): boolean {
  const { focus } = useComposerRequest.getState();
  if (!focus || focus.serverId !== serverId || focus.agentId !== agentId) return false;
  useComposerRequest.setState({ focus: null });
  return true;
}
