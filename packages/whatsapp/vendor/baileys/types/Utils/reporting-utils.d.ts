import { proto } from '../../WAProto/index.js';
import type { WAMessageContent, WAMessageKey } from '../Types';
import type { BinaryNode } from '../WABinary';
export type ReportingField = {
    f: number;
    m?: boolean;
    s?: ReportingField[];
};
export declare const shouldIncludeReportingToken: (message: proto.IMessage) => boolean;
export declare const getMessageReportingToken: (msgProtobuf: Buffer, message: WAMessageContent, key: WAMessageKey) => Promise<BinaryNode | null>;
