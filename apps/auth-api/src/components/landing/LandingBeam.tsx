import { type Component, onSettled } from "solid-js";

export interface LandingBeamProps {
  /** The element the beam lands on. The light runs along its top edge and spills down its sides. */
  surface: () => HTMLElement | undefined;
  /** The beam's horizontal position, as a fraction of the component's width. */
  beamPosition: number;
  /**
   * An element the beam falls through on its way to the surface: the light runs around its edge,
   * and the beam leaves from its bottom edge. It gets `data-beam-source` while the beam passes
   * through it. When its centre leaves no clear path onto the surface, `beamPosition` applies.
   */
  source?: () => HTMLElement | undefined;
  /** Elements the beam must not cross. The beam moves right of them when the screen is narrow. */
  avoid?: () => readonly Element[];
  /** A six-digit hex colour. The whole palette is derived from its hue and saturation. */
  color: string;
  /** The beam waits for this before it falls in. */
  start?: Promise<void>;
  /**
   * Called once, when the beam reaches the surface. It is called at once when the beam does not
   * fall in: with no beam module, with no WebGL2, with the reduced motion setting, or with no clear
   * path onto the surface.
   */
  onImpact?: () => void;
  class?: string;
}

// The beam is a port of LaserFlow from React Bits. Its license does not let a public repository
// contain it, so it is in the private `nightly-labs/openbot-laser-flow` repository. CI checks it out
// into this ignored path. A build without it has no beam, and the hero shows as it does after the hit.
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
