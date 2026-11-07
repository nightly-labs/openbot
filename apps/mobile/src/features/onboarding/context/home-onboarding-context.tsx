import { createContext, type PropsWithChildren, use, useMemo } from "react";
import { useOnboardingGate } from "@/features/onboarding/model/use-onboarding-gate";

type HomeOnboarding = ReturnType<typeof useOnboardingGate>;

const HomeOnboardingContext = createContext<HomeOnboarding | null>(null);

/**
 * Holds the first-run decision for the signed-in shell. Home shows the flow, and a wide window shows
 * no chat list pane while it runs, so both read the same decision.
 */
export function HomeOnboardingProvider({ children }: PropsWithChildren) {
  const { active, finish } = useOnboardingGate();
  const value = useMemo(() => ({ active, finish }), [active, finish]);
  return <HomeOnboardingContext value={value}>{children}</HomeOnboardingContext>;
}

export function useHomeOnboarding(): HomeOnboarding {
  const value = use(HomeOnboardingContext);
  if (!value) throw new Error("useHomeOnboarding requires HomeOnboardingProvider.");
  return value;
}
