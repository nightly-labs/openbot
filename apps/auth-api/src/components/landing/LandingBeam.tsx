import { type Component, onSettled } from "solid-js";

export interface LandingBeamProps {
  surface: () => HTMLElement | undefined;
  beamPosition: number;
  source?: () => HTMLElement | undefined;
  avoid?: () => readonly Element[];
  color: string;
  start?: Promise<void>;
  onImpact?: () => void;
  class?: string;
}

const LaserFlow = Object.values(
  import.meta.glob<Component<LandingBeamProps>>("../../vendor/laser-flow/LandingLaserFlow.tsx", {
    eager: true,
    import: "LandingLaserFlow",
  }),
)[0];

export function LandingBeam(props: LandingBeamProps) {
  if (LaserFlow) return <LaserFlow {...props} />;
  onSettled(() => props.onImpact?.());
  return null;
}
