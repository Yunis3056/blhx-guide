import tseslint from 'typescript-eslint'

/**
 * 全仓共用一份 flat config（ESLint 9 从包目录向上找父级配置）。
 * 只做类型无关的检查：`verbatimModuleSyntax` + `noUnusedLocals` 已经在 tsc 里
 * 管住了导入与死变量，这里再查一遍是重复工。
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.turbo/**', 'data/**', 'out/**', '.next/**', 'dist/**'],
  },
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 测试取样：`rows[0]!` 后面紧跟断言，noUncheckedIndexedAccess 逼着每个取样带 !。
    // 关掉换的是可读性，正确性由断言本身保证；src 侧不豁免。
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
)
