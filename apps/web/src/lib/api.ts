import { createTavernClient } from "@tavern/sdk";

export const apiBaseUrl = "/api";

export const apiClient = createTavernClient({
  baseUrl: apiBaseUrl,
});
