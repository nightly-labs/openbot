/** The search field, and the compact-mode button that expands the sidebar to reach it. */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Button, Input } from "@openbot/ui";
import { useText } from "../../text";
import { SearchIcon } from "./SidebarIcons";
import { useSidebarScope } from "./sidebar-scope";

export function SidebarSearch() {
  const { expandToSearch, props, query, setQuery, setSearchInputElement } = useSidebarScope();
  const { t } = useText();
  return (
    <div class="sidebar-search-wrap">
      <label class="search-field" aria-hidden={props.compact ? "true" : undefined}>
        <span class="sr-only">{t("sidebar.search.label")}</span>
        <SearchIcon />
        <Input
          ref={setSearchInputElement}
          type="search"
          value={query()}
          onValueChange={setQuery}
          placeholder={t("common.search")}
          aria-label={t("sidebar.search.label")}
          tabindex={props.compact ? -1 : 0}
          maxlength={INPUT_LIMITS.agentName}
        />
      </label>
      <Button
        variant="ghost"
        type="button"
        class="sidebar-compact-search"
        aria-label={t("sidebar.search.expand")}
        aria-hidden={props.compact ? undefined : "true"}
        tabindex={props.compact ? 0 : -1}
        onClick={expandToSearch}
      >
        <SearchIcon />
      </Button>
    </div>
  );
}
