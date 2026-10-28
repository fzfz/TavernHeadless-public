import { z } from "zod";
import configuredPagination from "../config/role-runtime-history-pagination.json" with { type: "json" };

export const roleRuntimeHistoryPaginationSchema = z
  .object({
    defaultLimit: z.number().int().positive(),
    maxLimit: z.number().int().positive(),
    maxCursorLength: z.number().int().positive(),
  })
  .strict()
  .refine((pagination) => pagination.defaultLimit <= pagination.maxLimit);

export const roleRuntimeHistoryPagination =
  roleRuntimeHistoryPaginationSchema.parse(configuredPagination);

export type RoleRuntimeHistoryPagination = z.infer<
  typeof roleRuntimeHistoryPaginationSchema
>;
