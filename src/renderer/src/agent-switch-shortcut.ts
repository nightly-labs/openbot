interface AgentSwitchChord {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The agent number of a chord: `Cmd+Option+1-9` on macOS, `Ctrl+Alt+1-9` elsewhere. It matches
 * `event.code`, because Option changes `event.key` on macOS. It does not check the platform or the
 * AltGr state, so a visual reply's page can use it for the key it forwards. The app's own handler
 * checks both with `agentSwitchIndex`.
 */
export function isAgentSwitchChord(chord: AgentSwitchChord): boolean {
  return (chord.metaKey || chord.ctrlKey) && chord.altKey && !chord.shiftKey && /^Digit[1-9]$/u.test(chord.code);
}

/**
 * The zero-based position of the agent that the event names, or null. Windows reports AltGr as
 * Ctrl+Alt, so an event with AltGraph set is typing, not a shortcut. `Cmd+1-9` and `Ctrl+1-9`
 * switch servers, so a chord with no Alt is not one of these.
 */
export function agentSwitchIndex(
  event: AgentSwitchChord & Pick<KeyboardEvent, "isComposing" | "repeat" | "getModifierState">,
  isMac: boolean,
): number | null {
  if (event.isComposing || event.repeat || !isAgentSwitchChord(event)) return null;
  if (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return null;
  if (event.getModifierState("AltGraph")) return null;
  return Number(event.code.slice(5)) - 1;
}
