import { createStore } from "solid-js";

interface AsyncPanel {
  /** The key of the one action in flight, or `null`. A list load is `loading`, not an action. */
  busy: string | null;
  error: string | null;
  loading: boolean;
}

/** One record for load/action/error; `run` reports rejection as error. */
export function createAsyncPanel(describeError: (cause: unknown) => string) {
  const [panel, setPanel] = createStore<AsyncPanel>({ busy: null, error: null, loading: false });

  function setBusy(key: string | null): void {
    setPanel((state) => {
      state.busy = key;
    });
  }

  function setError(message: string | null): void {
    setPanel((state) => {
      state.error = message;
    });
  }

  function setLoading(loading: boolean): void {
    setPanel((state) => {
      state.loading = loading;
    });
  }

  /** Awaits `work`; rejection becomes panel error, `undefined` on failure. */
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(describeError(cause));
      return undefined;
    }
  }

  return { panel, run, setBusy, setError, setLoading };
}
