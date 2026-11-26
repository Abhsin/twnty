import { defineConfig } from "vite";

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
  },
});
