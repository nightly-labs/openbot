import type { BinaryNode } from '../WABinary';
export declare const executeWMexQuery: <T>(variables: Record<string, unknown>, queryId: string, dataPath: string, query: (node: BinaryNode) => Promise<BinaryNode>, generateMessageTag: () => string) => Promise<T>;
