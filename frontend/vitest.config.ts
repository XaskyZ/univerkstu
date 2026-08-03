import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: { tsconfigPaths: true },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['.next/**', 'node_modules/**'],
        passWithNoTests: true,
    },
});
