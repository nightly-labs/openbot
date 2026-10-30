import { proto } from '../../WAProto/index.js';
import type { BaileysEventEmitter, BaileysEventMap, Contact } from '../Types';
import type { ILogger } from './logger';
export type ContactsUpsertResult = {
    event: 'contacts.upsert';
    data: Contact[];
};
export type LidMappingUpdateResult = {
    event: 'lid-mapping.update';
    data: BaileysEventMap['lid-mapping.update'];
};
export type SyncActionResult = ContactsUpsertResult | LidMappingUpdateResult;
/**
 * Process contactAction and return events to emit.
 * Pure function - no side effects.
 */
export declare const processContactAction: (action: proto.SyncActionValue.IContactAction, id: string | undefined, logger?: ILogger) => SyncActionResult[];
export declare const emitSyncActionResults: (ev: BaileysEventEmitter, results: SyncActionResult[]) => void;
