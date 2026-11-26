import { createEffect, For } from "solid-js";
import { ButtonLink } from "../ui/button";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";
import { useLandingText } from "./LandingText";
import { mountPricingGlass } from "./pricing-glass";
import { useSitePath } from "./SiteText";

export function PricingSection() {
  let sectionRef: HTMLElement | undefined;
  let eyebrowRef: HTMLHeadingElement | undefined;
  let factsRef: HTMLUListElement | undefined;
  let amountRef: HTMLParagraphElement | undefined;
  let actionsRef: HTMLDivElement | undefined;
  let layerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let handleRef: HTMLDivElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const revealState = () => (revealed() ? "true" : "false");
  const landing = useLandingText();
  const path = useSitePath();
  const text = () => landing().pricing;

  createEffect(revealed, (shown) => {
    if (!shown || !sectionRef || !eyebrowRef || !factsRef || !amountRef || !actionsRef || !layerRef || !canvasRef)
      return;
    return mountPricingGlass(
      {
        section: sectionRef,
        copy: [eyebrowRef, factsRef],
        amount: amountRef,
        actions: actionsRef,
        layer: layerRef,
        canvas: canvasRef,
        handle: handleRef,
      },
      () => text().eggs,
    );
  });

  return (
    <section ref={sectionRef} class="landing-pricing" aria-labelledby="pricing-title">
      <div class="landing-pricing-inner">
        <h2 ref={eyebrowRef} id="pricing-title" class="landing-pricing-eyebrow" data-revealed={revealState()}>
          {text().title}
        </h2>
        <div class="landing-pricing-stage">
          <p ref={amountRef} class="landing-pricing-amount" data-amount="$0" data-revealed={revealState()}>
            $0
          </p>
        </div>
        <ul ref={factsRef} class="landing-pricing-facts" data-revealed={revealState()}>
          <For each={text().facts}>
            {(fact) => (
              <li>
                <LandingIcon name="check" class="landing-pricing-fact-icon" />
                {fact}
              </li>
            )}
          </For>
        </ul>
        <div ref={actionsRef} class="landing-pricing-actions" data-revealed={revealState()}>
          <ButtonLink to="/download" variant="primary" size="md" icon="download">
            {text().download}
          </ButtonLink>
          <ButtonLink to={path("/pricing")} variant="secondary" size="md" icon="arrow-right">
            {text().license}
          </ButtonLink>
        </div>
      </div>
      <div ref={layerRef} class="landing-pricing-glass" aria-hidden="true" data-revealed={revealState()}>
        <canvas ref={canvasRef} class="landing-pricing-glass-canvas" />
        <div ref={handleRef} class="landing-pricing-glass-handle" />
      </div>
    </section>
  );
}
