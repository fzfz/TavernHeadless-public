import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command }) => ({
  appType: "mpa",
  envDir: false,
  envPrefix: [],
  resolve: {
    conditions:
      command === "serve"
        ? ["development", "module", "browser"]
        : ["production", "module", "browser"],
  },
  plugins: [vue()],
  server: {
    host: process.env.TAVERN_VITE_HOST,
    port: process.env.TAVERN_VITE_PORT
      ? Number(process.env.TAVERN_VITE_PORT)
      : undefined,
    strictPort: true,
    allowedHosts: JSON.parse(
      process.env.TAVERN_ALLOWED_HOSTS ?? "[]",
    ) as string[],
    hmr: {
      host: process.env.TAVERN_HMR_HOST,
      clientPort: process.env.TAVERN_HMR_PORT
        ? Number(process.env.TAVERN_HMR_PORT)
        : undefined,
    },
  },
}));
