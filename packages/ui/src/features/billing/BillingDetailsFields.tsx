import {
  BILLING_COUNTRIES,
  type BillingDetails,
  type BillingDetailsRequest,
  isEuVatCountry,
  normalizeVatId,
  vatIdPrefix,
} from "@openbot/contracts/billing-details";
import { Field, Input, Label, SearchSelect } from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, Show, untrack } from "solid-js";
import { useText } from "../../text";

export interface BillingDetailsCalls {
  getDetails: () => Promise<BillingDetails>;
  setDetails: (request: BillingDetailsRequest) => Promise<BillingDetails>;
}

export interface BillingDetailsDraft {
  country: string | null;
  vatId: string;
}

export function billingDetailsDraft(details: BillingDetails | null): BillingDetailsDraft {
  return { country: details?.country ?? details?.suggestedCountry ?? null, vatId: details?.vatId ?? "" };
}

export function billingDetailsRequest(draft: BillingDetailsDraft): BillingDetailsRequest | null {
  if (!draft.country) return null;
  if (!isEuVatCountry(draft.country) || draft.vatId.trim() === "") return { country: draft.country };
  const vatId = normalizeVatId(draft.country, draft.vatId);
  return vatId ? { country: draft.country, vatId } : null;
}

export async function saveBillingDetails(
  calls: BillingDetailsCalls,
  saved: BillingDetails | null,
  draft: BillingDetailsDraft,
): Promise<BillingDetails | null> {
  const request = billingDetailsRequest(draft);
  if (!request) return saved;
  if (saved && saved.country === request.country && saved.vatId === (request.vatId ?? null)) return saved;
  return calls.setDetails(request);
}

export function BillingDetailsFields(props: {
  value: BillingDetailsDraft;
  onChange: (value: BillingDetailsDraft) => void;
  disabled?: boolean | undefined;
}) {
  const { t, locale } = useText();
  const countryLabel = `billing-details-country-${createUniqueId()}`;
  const countryValue = `${countryLabel}-value`;
  let root: HTMLDivElement | undefined;
  const listMount = () => root?.closest("[role=dialog],[role=alertdialog]") ?? undefined;
  const regionNames = createMemo(() => new Intl.DisplayNames([locale()], { type: "region" }));
  const countryName = (code: string) => regionNames().of(code) ?? code;
  const countries = createMemo(() => {
    const collator = new Intl.Collator(locale());
    return [...BILLING_COUNTRIES].sort((a, b) => collator.compare(countryName(a), countryName(b)));
  });
  const [vatIdLeft, setVatIdLeft] = createSignal(false);
  const euCountry = () => {
    const country = props.value.country;
    return country !== null && isEuVatCountry(country) ? country : null;
  };
  const vatIdError = () => {
    const country = euCountry();
    if (!country || !vatIdLeft() || props.value.vatId.trim() === "") return undefined;
    return normalizeVatId(country, props.value.vatId) ? undefined : t("billing.details.vatIdInvalid");
  };

  return (
    <div ref={root} class="billing-details-fields">
      <div class="ui-field">
        <Label id={countryLabel}>{t("billing.details.country")}</Label>
        <SearchSelect<string>
          options={countries()}
          value={props.value.country}
          label={countryName}
          disabled={props.disabled}
          mount={listMount()}
          aria-labelledby={`${countryLabel} ${countryValue}`}
          onChange={(country) => props.onChange({ ...props.value, country })}
        >
          <span
            id={countryValue}
            class="ui-select-value billing-details-country"
            data-empty={props.value.country === null ? "" : undefined}
          >
            {props.value.country === null ? t("billing.details.countryPlaceholder") : countryName(props.value.country)}
          </span>
        </SearchSelect>
      </div>
      <Show when={euCountry()}>
        {(country) => (
          <Field label={t("billing.details.vatId")} error={vatIdError()}>
            <Input
              value={props.value.vatId}
              placeholder={vatIdPrefix(country())}
              autocomplete="off"
              spellcheck={false}
              disabled={props.disabled}
              onValueChange={(vatId) => {
                setVatIdLeft(false);
                props.onChange({ ...props.value, vatId });
              }}
              onBlur={() => setVatIdLeft(true)}
            />
          </Field>
        )}
      </Show>
    </div>
  );
}

export function createBillingDetailsForm(calls: () => BillingDetailsCalls | undefined) {
  const { t, errorMessage } = useText();
  const [saved, setSaved] = createSignal<BillingDetails | null>(null);
  const [draft, setDraft] = createSignal<BillingDetailsDraft>(billingDetailsDraft(null));
  const [edited, setEdited] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [known, setKnown] = createSignal(false);
  const api = untrack(calls);
  const loaded: Promise<string | null> = api
    ? api.getDetails().then(
        (details) => {
          setSaved(details);
          if (!untrack(edited)) setDraft(billingDetailsDraft(details));
          setKnown(true);
          return details.country;
        },
        () => {
          setKnown(true);
          return null;
        },
      )
    : Promise.resolve(null);
  async function save(): Promise<boolean> {
    const current = calls();
    if (!current) return true;
    if (!billingDetailsRequest(draft())) {
      setError(t("billing.details.countryMissing"));
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      setSaved(await saveBillingDetails(current, saved(), draft()));
      return true;
    } catch (failure) {
      setError(errorMessage(failure, t("billing.details.saveFailed")));
      return false;
    } finally {
      setSaving(false);
    }
  }
  return {
    saved,
    known,
    draft,
    saving,
    error,
    loaded,
    save,
    edit: (next: BillingDetailsDraft) => {
      setEdited(true);
      setError(null);
      setDraft(next);
    },
  };
}
