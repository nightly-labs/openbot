import type { CreditMediaCatalog } from "@openbot/contracts/credit-media";

export const CREDITS_ENABLED: boolean = false;

export const NO_CREDIT_MEDIA_MODELS: CreditMediaCatalog = { models: [] };

export function whenCreditsEnabled<Service>(service: Service | null): Service | null {
  return CREDITS_ENABLED ? service : null;
}
