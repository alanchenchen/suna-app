import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const gatewayTarget = "http://127.0.0.1:7633";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: gatewayTarget,
        changeOrigin: false,
      },
      "/healthz": {
        target: gatewayTarget,
        changeOrigin: false,
      },
    },
  },
});
