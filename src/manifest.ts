import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Video Text Selector",
  version: "0.1.0",
  description:
    "Cmd/Ctrl-click text inside any playing video to make it selectable and copyable, just like text on a webpage.",
  homepage_url: "https://github.com/jobrienski/video-text-selector",
  icons: {
    16: "icons/icon16.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
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
