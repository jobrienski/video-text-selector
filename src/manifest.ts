import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Selectable Video Text",
  version: "0.1.0",
  description: "cmd-click text in a playing video to select and copy it.",
  permissions: ["tabs", "activeTab", "offscreen"],
  host_permissions: ["<all_urls>"],
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    {
      resources: ["assets/tesseract/*"],
      matches: ["<all_urls>"],
    },
  ],
});
