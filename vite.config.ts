import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  // En desarrollo, la API la atiende `wrangler dev` en el puerto 8787.
  server: {
    proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/webhook": "http://localhost:8787" }
  }
});
