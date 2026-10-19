import { defineConfig } from 'vitest/config';

// Accuracy evaluation on Tatoeba sentences (run scripts/fetch_eval_data.sh first).
export default defineConfig({
  test: {
    include: ['eval/**/*.test.ts'],
    testTimeout: 600000,
  },
});
