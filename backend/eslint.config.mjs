import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', '**/*.test.ts', '**/*.spec.ts'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        rules: {
            // tsc уже ловит unused через noUnusedLocals/noUnusedParameters.
            // Здесь оставляем правило выключенным, чтобы избежать дублей.
            '@typescript-eslint/no-unused-vars': 'off',
            // Парсеры активно используют `any` для shape-агностичного JSON из Platonus/KSTU.
            '@typescript-eslint/no-explicit-any': 'off',
            // У нас есть несколько empty catch для интенциональной защиты от рекурсии трейса.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Pre-fetched/cached promises у фастифая иногда без `.catch` — мы оборачиваем
            // в Promise.all где это важно, остальное обработают onError hooks.
            '@typescript-eslint/no-floating-promises': 'off',
        },
    },
);
