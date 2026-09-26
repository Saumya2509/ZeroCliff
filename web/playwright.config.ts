import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // reduced motion: screenshots show final states, and the reduced-motion path gets exercised
  use: { baseURL: "http://localhost:3100", contextOptions: { reducedMotion: "reduce" } },
  projects: [
    { name: "phone-375", use: { viewport: { width: 375, height: 800 } } },
    { name: "projector-1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "dark-1280", use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
  ],
  webServer: { command: "npx next start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 120_000 },
});
