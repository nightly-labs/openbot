export function pendingNavigation<Target>() {
  let navigate: ((target: Target) => void) | null = null;
  let pending: Target | null = null;
  let signedOut = false;
  return {
    receive(target: Target | null): void {
      if (!target || signedOut) return;
      if (navigate) navigate(target);
      else pending = target;
    },
    setNavigator(open: (target: Target) => void): () => void {
      signedOut = false;
      navigate = open;
      const waiting = pending;
      pending = null;
      if (waiting) open(waiting);
      return () => {
        if (navigate === open) navigate = null;
      };
    },
    reset(): void {
      signedOut = true;
      pending = null;
    },
  };
}
