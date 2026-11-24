import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "ai-office-host-opencode": path.resolve(__dirname, "packages/ai-office-host-opencode/dist/OpenCodeAdapter.js"),
      "ai-office-core": path.resolve(__dirname, "packages/ai-office-core/dist/index.js"),
      "ai-office-core/tripwire": path.resolve(__dirname, "packages/ai-office-core/dist/tripwire.js"),
      "ai-office-core/sandbox": path.resolve(__dirname, "packages/ai-office-core/dist/sandbox.js"),
      "ai-office-core/hooks/scopeGuard": path.resolve(__dirname, "packages/ai-office-core/dist/hooks/scopeGuard.js"),
      "ai-office-core/log": path.resolve(__dirname, "packages/ai-office-core/dist/log.js"),
      "ai-office-core/childModel": path.resolve(__dirname, "packages/ai-office-core/dist/childModel.js"),
      "ai-office-core/tools": path.resolve(__dirname, "packages/ai-office-core/dist/tools/index.js"),
      "ai-office-core/dashboard": path.resolve(__dirname, "packages/ai-office-core/dist/dashboard.js"),
      "ai-office-core/mesa": path.resolve(__dirname, "packages/ai-office-core/dist/mesa.js"),
      "ai-office-core/systemPrompt": path.resolve(__dirname, "packages/ai-office-core/dist/systemPrompt.js"),
      "ai-office-core/host": path.resolve(__dirname, "packages/ai-office-core/dist/host/index.js"),
      "ai-office-core/host/AdapterFactory": path.resolve(__dirname, "packages/ai-office-core/dist/host/AdapterFactory.js"),
      "ai-office-core/host/index": path.resolve(__dirname, "packages/ai-office-core/dist/host/index.js"),
      "@opencode/plugin": path.resolve(__dirname, "node_modules/@opencode/plugin"),
      "../src/v2.js": path.resolve(__dirname, "src/v2.ts"),
      "../src/v1.ts": path.resolve(__dirname, "src/v1.ts"),
    },
  },
  test: {
    include: ["packages/ai-office-core/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    environment: "node",
    isolate: false,
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/core/**/*.ts",
        "src/hooks/**/*.ts",
        "src/v1.ts",
        "src/v2.ts",
        "src/cli.ts",
      ],
      exclude: [
        "src/core/log.ts",
        "src/core/docsync.ts",
      ],
      thresholds: {
        lines: 73,
        functions: 76,
        branches: 64,
        statements: 70,
      },
    },
  },
})