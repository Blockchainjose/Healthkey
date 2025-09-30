// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const processBrowser = require.resolve("process/browser");
const bufferModule = require.resolve("buffer");
const streamBrowserify = require.resolve("stream-browserify");
const cryptoBrowserify = require.resolve("crypto-browserify");
const assertModule = require.resolve("assert");
const utilModule = require.resolve("util");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^process\/?$/, replacement: processBrowser },
      { find: "buffer", replacement: bufferModule },
      { find: "stream", replacement: streamBrowserify },
      { find: "crypto", replacement: cryptoBrowserify },
      { find: "assert", replacement: assertModule },
      { find: "util", replacement: utilModule },
    ],
  },
  define: {
    global: "window",
    "process.env": {},
  },
  optimizeDeps: {
    include: [
      "buffer",
      "process/browser",
      "stream-browserify",
      "crypto-browserify",
      "assert",
      "util",
    ],
  },
});
