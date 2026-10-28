<script setup lang="ts">
import type { RoleInspectionTableSpec } from "../../lib/role-inspection.schema.js";
import config from "../../config/role-inspection-tables.json";
defineProps<{ spec: RoleInspectionTableSpec; rows: unknown[] }>();
function cell(row: unknown, key: string) {
  if (!row || typeof row !== "object") return "";
  const value = (row as Record<string, unknown>)[key];
  return value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
</script>
<template>
  <section>
    <h2>{{ spec.title }}</h2>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="column in spec.columns" :key="column[0]">
              {{ column[1] }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="index">
            <td v-for="column in spec.columns" :key="column[0]">
              <details v-if="column[0] === '$detail'">
                <summary>{{ config.details }}</summary>
                <pre>{{ JSON.stringify(row, null, 2) }}</pre>
              </details>
              <template v-else>{{ cell(row, column[0]!) }}</template>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="spec.columns.length" class="empty">
              {{ config.empty }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
