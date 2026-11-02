import { ContextMenu } from "@kobalte/core/context-menu";
import { AppLogo } from "@openbot/brand";
import { Link, useRouter } from "@tanstack/solid-router";
import { BRAND_ROUTE } from "../../lib/brand-page";
import { LandingIcon } from "../landing/LandingIcon";

type BrandFiles = typeof import("./brand-files");

/**
 * The home link in the site header. A right-click, a long press, or the menu key on it opens a menu
 * with the logo files, as on linear.app.
 *
 * The trigger wraps the link and takes no space of its own. The menu is a sibling of the link, so a
 * click on an item never reaches the link and opens the home page. It stays in the header, not in a
 * portal, so it is inside the page's banner landmark.
 *
 * The header is on every page, so the logo files load only when the menu opens.
 */
export function SiteLogoLink() {
  const router = useRouter();
  let link: HTMLAnchorElement | undefined;
  let trigger: HTMLSpanElement | undefined;
  let fromKeyboard = false;
  let files: Promise<BrandFiles> | undefined;
  const loadFiles = () => {
    files ??= import("./brand-files");
    return files;
  };
  // A copy must start in the same task as the click in Safari, so it needs the module already loaded.
  let loaded: BrandFiles | undefined;
  const handleOpenChange = (open: boolean) => {
    if (open) {
      void loadFiles().then((module) => (loaded = module));
      return;
    }
    // A menu that is not modal does not return focus. Kobalte moves focus after this callback, so
    // focus the link a frame later.
    if (fromKeyboard) requestAnimationFrame(() => link?.focus());
    fromKeyboard = false;
  };
  // A copy fails when the clipboard is not allowed. The menu has closed, so there is nothing to show.
  const run = (action: (module: BrandFiles) => Promise<void>) => {
    const done = loaded ? action(loaded) : loadFiles().then(action);
    void done.catch(() => undefined);
  };

  // The menu key and Shift+F10 open the menu under the logo. When it closes, focus goes back to the link.
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const box = link?.getBoundingClientRect();
    if (!box) return;
    fromKeyboard = true;
    trigger?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: box.left, clientY: box.bottom + 6 }),
    );
  };

  return (
    <ContextMenu modal={false} onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger as="span" ref={trigger} class="site-logo-trigger">
        <Link ref={link} class="landing-brand" to="/" aria-label="OpenBot home" onKeyDown={handleKeyDown}>
          <AppLogo variant="production" class="landing-brand-logo" />
          <span>OpenBot</span>
        </Link>
      </ContextMenu.Trigger>
      <ContextMenu.Content class="site-logo-menu" aria-label="Logo">
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.copyBrandIcon())}>
          <AppLogo variant="production" class="site-logo-menu-icon" />
          Copy logo as SVG
        </ContextMenu.Item>
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.copyBrandLockup())}>
          <LandingIcon name="code" class="site-logo-menu-icon" />
          Copy logo with name as SVG
        </ContextMenu.Item>
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.saveBrandZip())}>
          <LandingIcon name="download" class="site-logo-menu-icon" />
          Download brand assets
        </ContextMenu.Item>
        <ContextMenu.Separator class="site-logo-menu-separator" />
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => void router.navigate({ to: BRAND_ROUTE })}>
          <LandingIcon name="arrow-right" class="site-logo-menu-icon" />
          Open brand page
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
}
