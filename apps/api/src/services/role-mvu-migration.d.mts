import type { ZodType } from 'zod';
export type MigratedEntryUsage = {sourceEntryId:number;usage:'variable-rule'|'retired-protocol'|'opening-state';target:string};
export const migratedEntryUsageSchema: ZodType<MigratedEntryUsage>;
export function validateMigratedMvu(bundle:unknown, worldbook:unknown): Array<{entryId?:number;file?:string;reason:string;target?:string}>;
