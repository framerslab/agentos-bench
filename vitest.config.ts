// @ts-nocheck
import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const localPath = path.resolve(__dirname, '../agentos/src');
const ciPath = path.resolve(__dirname, '../../../../packages/agentos/src');

const agentosPath = fs.existsSync(localPath)
  ? localPath
  : fs.existsSync(ciPath)
    ? ciPath
    : null;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30000,
  },
  resolve: agentosPath
    ? {
        alias: {
          '@framers/agentos': agentosPath,
        },
      }
    : {},
});
