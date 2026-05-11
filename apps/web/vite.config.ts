import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => {
  if (command === 'build' && process.env.NEXT_PUBLIC_USE_MOCK_FALLBACK === 'true') {
    throw new Error('NEXT_PUBLIC_USE_MOCK_FALLBACK must be false in production');
  }

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '$lib': fileURLToPath(new URL('./src/lib', import.meta.url))
      }
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.mjs']
    }
  };
});
