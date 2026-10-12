import { translateFor } from "@openbot/i18n";
import { expect, test } from "@playwright/test";

const t = translateFor("en");
const cases = [
  { name: "chat", story: "conversation-conversation--rich-conversation" },
  { name: "streaming", story: "conversation-conversation--streaming-snapshot" },
  { name: "approval", story: "conversation-approvalcard--command" },
  { name: "delegation-menu", story: "conversation-chat-action-marker--agent-recipients-menu" },
  { name: "file-preview", story: "conversation-filepreviewpanel--markdown" },
  { name: "narrow-chat", story: "conversation-conversation--narrow-rich-conversation" },
];

for (const scenario of cases)
  test(`${scenario.name} retains its visual layout`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
    // A fixed sequence, not a constant: code that retries until a random ID is unique must still end.
    await page.addInitScript(() => {
      let seed = 1;
      Math.random = () => {
        seed = (seed * 16_807) % 2_147_483_647;
        return (seed - 1) / 2_147_483_646;
      };
    });
    if (scenario.name === "narrow-chat") await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${process.env.OPENBOT_VISUAL_BASE_URL}/iframe.html?id=${scenario.story}&viewMode=story&globals=locale:en`,
    );
    if (scenario.name === "approval")
      await expect(page.getByRole("button", { name: t("prompt.approval.allow"), exact: true })).toBeVisible();
    else if (scenario.name === "delegation-menu") {
      const trigger = page.getByRole("button", { name: t("chat.marker.agentCount", { count: 3 }), exact: true });
      await expect(trigger).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await trigger.focus();
      await trigger.press("ArrowDown");
      await expect(page.getByRole("menu")).toBeInViewport();
      await expect(page.getByRole("menuitem")).toHaveCount(3);
      // The focus ring is part of the screenshot.
      await expect(page.getByRole("menuitem").first()).toBeFocused();
    } else if (scenario.name === "file-preview")
      await expect(page.getByRole("complementary", { name: t("preview.panel.label") })).toBeVisible();
    // Storybook compiles the conversation modules on the first request.
    else await expect(page.getByRole("main", { name: t("conversation.view.label") })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${scenario.name}.png`);
    if (scenario.name === "delegation-menu") await expect(page.getByRole("menu")).toBeInViewport();
  });
