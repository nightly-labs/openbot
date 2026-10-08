import {
  type UiBlockResponse,
  type UiBlockSpec,
  type UiBlockState,
  validateUiBlockResponse,
} from "@openbot/contracts/ui-blocks";

/**
 * What every blocking block takes. The components know nothing about IPC: the host owns the stored
 * `state` and hands the answer to `onRespond`.
 */
export interface UiBlockProps<Spec extends UiBlockSpec> {
  spec: Spec;
  /** Absent means the block is open (`pending`). */
  state?: UiBlockState | undefined;
  /** Gets a response that `validateUiBlockResponse` accepted for `spec`. */
  onRespond: (response: UiBlockResponse) => void;
  /** The person may not answer, for example a member without the right. */
  disabled?: boolean | undefined;
  /** An answer is on its way; controls wait for it. */
  busy?: boolean | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
}

export const PENDING_UI_BLOCK_STATE: UiBlockState = { status: "pending" };

export function uiBlockState(props: { state?: UiBlockState | undefined }): UiBlockState {
  return props.state ?? PENDING_UI_BLOCK_STATE;
}

/** Checks the response against the spec and gives it to the host. False when the spec refuses it. */
export function sendUiBlockResponse(
  spec: UiBlockSpec,
  response: UiBlockResponse,
  onRespond: (response: UiBlockResponse) => void,
): boolean {
  const valid = validateUiBlockResponse(spec, response);
  if (valid === null) return false;
  onRespond(valid);
  return true;
}

/** The key letter of the option at `index`: A, B, C... */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The option index for a letter key, or -1. */
export function optionIndexForKey(key: string): number {
  return key.length === 1 && /^[a-z]$/iu.test(key) ? key.toUpperCase().charCodeAt(0) - 65 : -1;
}
