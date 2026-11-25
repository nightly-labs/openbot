import { ContextMenu } from "@kobalte/core/context-menu";
import { AppLogo } from "@openbot/brand";
import { Link, useRouter } from "@tanstack/solid-router";
import { BRAND_ROUTE } from "../../lib/brand-page";
import { localizedPath } from "../../lib/site-paths";
import { LandingIcon } from "../landing/LandingIcon";
import { useSiteChrome } from "../landing/SiteText";

type BrandFiles = typeof import("./brand-files");

export function SiteLogoLink() {
  const router = useRouter();
  const chrome = useSiteChrome();
  const text = () => chrome().text;
  let link: HTMLAnchorElement | undefined;
  let trigger: HTMLSpanElement | undefined;
  let fromKeyboard = false;
  let files: Promise<BrandFiles> | undefined;
  const loadFiles = () => {
    files ??= import("./brand-files");
    return files;
  };
  let loaded: BrandFiles | undefined;
  const handleOpenChange = (open: boolean) => {
    if (open) {
      void loadFiles().then((module) => (loaded = module));
      return;
    }
    if (fromKeyboard) requestAnimationFrame(() => link?.focus());
    fromKeyboard = false;
  };
  const run = (action: (module: BrandFiles) => Promise<void>) => {
    const done = loaded ? action(loaded) : loadFiles().then(action);
    void done.catch(() => undefined);
  };

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
        <Link
          ref={link}
          class="landing-brand"
          to={localizedPath("/", chrome().locale)}
          aria-label={text().home}
          onKeyDown={handleKeyDown}
        >
          <AppLogo variant="production" class="landing-brand-logo" />
          <span>OpenBot</span>
        </Link>
      </ContextMenu.Trigger>
      <ContextMenu.Content class="site-logo-menu" aria-label={text().logo.menu}>
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.copyBrandIcon())}>
          <AppLogo variant="production" class="site-logo-menu-icon" />
          {text().logo.copyIcon}
        </ContextMenu.Item>
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.copyBrandLockup())}>
          <LandingIcon name="code" class="site-logo-menu-icon" />
          {text().logo.copyLockup}
        </ContextMenu.Item>
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => run((module) => module.saveBrandZip())}>
          <LandingIcon name="download" class="site-logo-menu-icon" />
          {text().logo.downloadAssets}
        </ContextMenu.Item>
        <ContextMenu.Separator class="site-logo-menu-separator" />
        <ContextMenu.Item class="site-logo-menu-item" onSelect={() => void router.navigate({ to: BRAND_ROUTE })}>
          <LandingIcon name="arrow-right" class="site-logo-menu-icon" />
          {text().logo.openBrand}
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
}
