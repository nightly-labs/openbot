import { createContext, type PropsWithChildren, use, useMemo } from "react";
import { useOnboardingGate } from "@/features/onboarding/model/use-onboarding-gate";

type HomeOnboarding = ReturnType<typeof useOnboardingGate>;

const HomeOnboardingContext = createContext<HomeOnboarding | null>(null);

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
