const END_SLACK = 24;

export function stickToBottom(list: HTMLElement): () => void {
  let atEnd = true;
  const onScroll = () => {
    atEnd = list.scrollHeight - list.scrollTop - list.clientHeight <= END_SLACK;
  };
  const resize = new ResizeObserver(() => {
    if (atEnd) list.scrollTop = list.scrollHeight;
  });
  const watchRows = () => {
    for (const row of list.children) resize.observe(row);
  };
  const rows = new MutationObserver(watchRows);
  watchRows();
  rows.observe(list, { childList: true });
  list.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    list.removeEventListener("scroll", onScroll);
    rows.disconnect();
    resize.disconnect();
  };
}
