export function createComposerSendGate() {
  let submitted = false;
  let closing = false;
  return {
    focus() {
      submitted = false;
      closing = false;
    },
    edit() {
      submitted = false;
    },
    allowRetry() {
      submitted = false;
    },
    submit(fieldFocused: boolean): boolean {
      if (submitted) return false;
      submitted = true;
      closing = fieldFocused;
      return true;
    },
    ignoresFieldText(): boolean {
      return closing;
    },
    endEditing(): boolean {
      const sentDraft = closing;
      closing = false;
      return sentDraft;
    },
  };
}
