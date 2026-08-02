import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/shared', 'packages/core', 'packages/llm', 'apps/server', 'apps/ui'],
    passWithNoTests: true,
  },
});
