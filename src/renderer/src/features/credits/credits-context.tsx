import type { CreditMediaCatalog, CreditMediaModel } from "@openbot/contracts/credit-media";
import type { JSX } from "@solidjs/web";
import { createContext, createSignal, type ParentProps, useContext } from "solid-js";

const CREDIT_MODELS_MAX_AGE_MS = 60 * 60 * 1000;

export type CreditModels = () => readonly CreditMediaModel[] | undefined;

const CreditModelsContext = createContext<CreditModels>(() => undefined, { name: "CreditModelsProvider" });

export function createCreditModels(load: () => Promise<CreditMediaCatalog>): CreditModels {
  const [models, setModels] = createSignal<readonly CreditMediaModel[] | undefined>(undefined);
  let loadedAt = Number.NEGATIVE_INFINITY;
  let loading = false;
  function refreshWhenStale() {
    if (loading || Date.now() - loadedAt < CREDIT_MODELS_MAX_AGE_MS) return;
    loading = true;
    load()
      .then((catalog) => {
        if (catalog.models.length > 0) loadedAt = Date.now();
        setModels(catalog.models);
      })
      .catch(() => undefined)
      .finally(() => {
        loading = false;
      });
  }
  return () => {
    refreshWhenStale();
    return models();
  };
}

export function CreditModelsProvider(props: ParentProps<{ models: CreditModels }>): JSX.Element {
  return <CreditModelsContext value={props.models}>{props.children}</CreditModelsContext>;
}

export function useCreditModels(): CreditModels {
  return useContext(CreditModelsContext);
}
