import { defineConfig } from "vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        break: resolve(__dirname, "src/break.html"),
        widget: resolve(__dirname, "src/widget.html"),
        settings: resolve(__dirname, "src/settings.html"),
      },
    },
  },
});

