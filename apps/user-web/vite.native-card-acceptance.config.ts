import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const publicDirectory = process.env.NATIVE_CARD_ACCEPTANCE_PUBLIC_DIR;
if (!publicDirectory) throw new Error("Set NATIVE_CARD_ACCEPTANCE_PUBLIC_DIR to the isolated acceptance public directory.");

export default mergeConfig(base, defineConfig({ publicDir: resolve(publicDirectory) }));
