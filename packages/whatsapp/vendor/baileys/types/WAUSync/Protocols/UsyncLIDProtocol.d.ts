import type { USyncQueryProtocol } from '../../Types/USync';
import type { BinaryNode } from '../../WABinary';
import type { USyncUser } from '../USyncUser';
export declare class USyncLIDProtocol implements USyncQueryProtocol {
    name: string;
    getQueryElement(): BinaryNode;
    getUserElement(user: USyncUser): BinaryNode | null;
    parser(node: BinaryNode): string | null;
}
