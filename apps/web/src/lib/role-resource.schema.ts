export type RoleResourceKind =
  | "preset"
  | "worldbook"
  | "regex"
  | "persona"
  | "model";
export type RoleResourceRow = {
  id: string;
  name: string;
  version?: number;
  revision?: number;
  status?: string;
  updatedAt: number;
};
export type RoleResourceDocument = {
  id: string;
  name: string;
  revision?: number;
  version?: number;
  value: Record<string, unknown>;
  entryKeys?: string[];
  entries?: Record<string, unknown>[];
  rawImport?: Record<string, unknown>;
};
