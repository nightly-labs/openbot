import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { PricingSection } from "../src/components/landing/PricingSection";
import { AppPreviewPage } from "../src/routes/app-preview.lazy";

describe("landing page", () => {
  it("serves the loading fallback and no hydrated content until the preview mounts", () => {
    const markup = renderToString(() => <AppPreviewPage />);

    expect(markup).toContain('aria-label="Loading OpenBot preview"');
    expect(markup).not.toContain('aria-label="Agent navigation"');
  });

  it("states the price in the server-rendered markup", () => {
    const markup = renderToString(() => <PricingSection />);

    expect(markup).toContain("What it costs");
    expect(markup).toContain("$0");
    expect(markup).toContain("OpenBot is free. No hidden fees. No locked features.");
  });
});
