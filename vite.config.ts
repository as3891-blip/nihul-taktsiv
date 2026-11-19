import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Build config (React plugin). Tests run in Node by default; the render test switches itself to jsdom.
export default defineConfig({ plugins: [react()] });
