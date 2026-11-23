import {
  type UiBlockResponse,
  type UiBlockSpec,
  type UiBlockState,
  validateUiBlockResponse,
} from "@openbot/contracts/ui-blocks";

export interface UiBlockProps<Spec extends UiBlockSpec> {
  spec: Spec;
  state?: UiBlockState | undefined;
  onRespond: (response: UiBlockResponse) => void;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  error?: string | undefined;
  onSkip?: (() => void) | undefined;
  class?: string | undefined;
  elementRef?: ((element: HTMLElement) => void) | undefined;
}

export const PENDING_UI_BLOCK_STATE: UiBlockState = { status: "pending" };

export function uiBlockState(props: { state?: UiBlockState | undefined }): UiBlockState {
  return props.state ?? PENDING_UI_BLOCK_STATE;
}

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

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function optionIndexForKey(key: string): number {
  return key.length === 1 && /^[a-z]$/iu.test(key) ? key.toUpperCase().charCodeAt(0) - 65 : -1;
}
