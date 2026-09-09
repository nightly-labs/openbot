/** Wait for native autocorrection/IME commit, and consume each send request once. */
export function createComposerSendGate() {
  let editing = false;
  let pending = false;
  let submitted = false;
  return {
    focus() {
      editing = true;
      submitted = false;
    },
    edit() {
      if (!pending) submitted = false;
    },
    cancel() {
      pending = false;
    },
    request(): "blur" | "send" | "none" {
      if (pending || submitted) return "none";
      if (editing) {
        pending = true;
        return "blur";
      }
      submitted = true;
      return "send";
    },
    commit() {
      editing = false;
      if (!pending) return false;
      pending = false;
      submitted = true;
      return true;
    },
    submit() {
      if (submitted) return false;
      pending = false;
      submitted = true;
      return true;
    },
  };
}
