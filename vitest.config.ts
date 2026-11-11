import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 120s: los tests tocan locks reales en disco y bajo carga (suite completa
    // en prepublish, máquina fría, antivirus en Windows) el default de 20s
    // produce falsos timeouts que no son defectos del motor.
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
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
})
