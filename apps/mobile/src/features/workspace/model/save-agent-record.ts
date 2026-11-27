import type { AgentMemory, Routine } from "@openbot/contracts/ipc";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

export async function saveAgentRecord<T extends AgentMemory | Routine>(
  client: QueryClient,
  queryKey: QueryKey,
  save: () => Promise<T>,
): Promise<void> {
  const saved = await save();
  await client.cancelQueries({ queryKey, exact: true });
  client.setQueriesData<T[]>({ queryKey, exact: true }, (records) => {
    if (!records) return records;
    return records.some((record) => record.id === saved.id)
      ? records.map((record) => (record.id === saved.id ? saved : record))
      : [...records, saved];
  });
}
