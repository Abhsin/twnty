import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "web",
  publicDir: "public",
  server: {
    port: 4173,
    fs: {
      allow: [".."],
    },
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "web/index.html"),
        guide: resolve(__dirname, "web/20-20-20-rule.html"),
        privacy: resolve(__dirname, "web/privacy.html"),
        thanks: resolve(__dirname, "web/thanks.html"),
      },
    },
  },
});
