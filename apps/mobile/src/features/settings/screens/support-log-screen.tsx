import { HeaderHeightContext } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { memo, useContext, useState, useSyncExternalStore } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  formatSupportLogEntry,
  type SupportLogEntry,
  type SupportLogLevel,
  supportLog,
} from "@/features/support/model/support-log";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const LEVEL_CLASS = {
  info: "text-grouped-secondary",
  warn: "text-warning-text",
  error: "text-danger-text",
} as const satisfies Record<SupportLogLevel, string>;
/**
 * Entries in one block. A block holds the entries whose IDs have the same quotient by this number,
 * so its edges do not move when the log drops its oldest entries. New entries change only the newest
 * block, and the other blocks do not render again.
 */
const BLOCK_LINES = 50;
/** The lines that the page shows at first, and that each "Show older events" adds. */
const PAGE_LINES = 500;
/** A list scrolled less than this far from its top still counts as at the top. */
const TOP_SLOP = 48;

interface LogBlockProps {
  entries: readonly SupportLogEntry[];
}

/** The blocks that hold at least the newest `shown` entries, newest block first. */
function logBlocks(entries: readonly SupportLogEntry[], shown: number): LogBlockProps[] {
  const blocks: LogBlockProps[] = [];
  let lines = 0;
  for (let end = entries.length; end > 0 && lines < shown; ) {
    const bucket = Math.floor((entries[end - 1]?.id ?? 0) / BLOCK_LINES);
    let start = end - 1;
    // Restored entries get their IDs after the first entries of this launch, so a block ends where
    // the quotient changes, not at a fixed index.
    while (start > 0 && Math.floor((entries[start - 1]?.id ?? 0) / BLOCK_LINES) === bucket) start -= 1;
    blocks.push({ entries: entries.slice(start, end) });
    lines += end - start;
    end = start;
  }
  return blocks;
}

const sameBlock = (previous: LogBlockProps, next: LogBlockProps) =>
  previous.entries.length === next.entries.length &&
  previous.entries[0]?.id === next.entries[0]?.id &&
  previous.entries.at(-1)?.id === next.entries.at(-1)?.id;

const LogBlock = memo(function LogBlock({ entries }: LogBlockProps) {
  return (
    <View className="gap-1">
      {[...entries].reverse().map((entry) => (
        <Typography.Paragraph
          key={entry.id}
          type="body-xs"
          className={`font-mono ${LEVEL_CLASS[entry.level]}`}
          selectable
        >
          {formatSupportLogEntry(entry)}
        </Typography.Paragraph>
      ))}
    </View>
  );
}, sameBlock);

/**
 * The support log, newest first, in the scroll view of the other settings pages, which owns the
 * header blur. At the top of the list new events appear at once. Lower down the list holds the
 * events it shows, so the lines do not move while the user reads them, and it catches up at the top.
 */
export function SupportLogScreen() {
  const { t } = useText();
  const live = useSyncExternalStore(supportLog.subscribe, supportLog.entries);
  const [held, setHeld] = useState<readonly SupportLogEntry[] | null>(null);
  const entries = held ?? live;
  const [shown, setShown] = useState(PAGE_LINES);
  // iOS insets the content under the transparent header, so the top of the list is above zero.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const top = isIOS ? -headerHeight : 0;
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const reading = event.nativeEvent.contentOffset.y > top + TOP_SLOP;
    if (reading && held === null) setHeld(live);
    else if (!reading && held !== null) setHeld(null);
  };
  const blocks = logBlocks(entries, shown);
  const showing = blocks.reduce((count, block) => count + block.entries.length, 0);
  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      contentContainerClassName="gap-5 px-4 pb-safe-offset-5 pt-5"
      onScroll={onScroll}
    >
      {entries.length === 0 ? (
        <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
          {t("mobile.settings.support.empty")}
        </Typography.Paragraph>
      ) : (
        <View className="gap-1">
          <Typography.Paragraph type="body-xs" className="px-4 pb-1 text-grouped-secondary">
            {t("mobile.settings.support.newestFirst")}
          </Typography.Paragraph>
          {blocks.map((block) => (
            <LogBlock key={block.entries[0]?.id} entries={block.entries} />
          ))}
        </View>
      )}
      {showing < entries.length ? (
        <SettingsSection>
          <SettingsRow onPress={() => setShown((count) => count + PAGE_LINES)} disclosure={false}>
            <Typography.Paragraph>{t("mobile.settings.support.showOlder")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </SheetScrollView>
  );
}
