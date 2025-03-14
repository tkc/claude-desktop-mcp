// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  // ファイル無視設定（.eslintignoreの代わり）
  ignores: ['node_modules/**', 'dist/**', 'build/**', '*.config.js'],
  // ルール設定
  rules: {
    // 基本ルール
    'no-console': ['warn', { allow: ['error', 'warn'] }],
    'no-unused-vars': 'off', // TypeScriptの対応するルールを使用するため無効化
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',

    // MCP特有のルール
    'no-process-exit': 'off', // MCPサーバーで必要な場合があるため無効化

    // コードスタイル
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'always'],
  },
});
