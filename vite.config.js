import { defineConfig } from "vite";

export default defineConfig({
  base: "/Client-Side-Zero-Cost-AI-Engine/",
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  worker: {
    format: "es",
  },
});
