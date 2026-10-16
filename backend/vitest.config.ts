import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    pool: "forks",
    // All test files share one real PostgreSQL instance, so they run one at a
    // time; `testDb()` truncates the domain tables before each test.
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
