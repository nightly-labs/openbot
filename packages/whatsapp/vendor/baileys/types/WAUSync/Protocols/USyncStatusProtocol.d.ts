import type { USyncQueryProtocol } from '../../Types/USync';
import { type BinaryNode } from '../../WABinary';
export type StatusData = {
    status?: string | null;
    setAt?: Date;
};
export declare class USyncStatusProtocol implements USyncQueryProtocol {
    name: string;
    getQueryElement(): BinaryNode;
    getUserElement(): null;
    parser(node: BinaryNode): StatusData | undefined;
}
