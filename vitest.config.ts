import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'rules',
          include: ['tests/rules/**/*.test.ts'],
          environment: 'node',
          // Rules tests talk to the emulator over HTTP and each case does several
          // round trips; the default 5s is too tight on a cold emulator.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          // A shared emulator project is global state — parallel files would
          // interleave writes and make failures irreproducible.
          fileParallelism: false,
        },
      },
    ],
  },
});
