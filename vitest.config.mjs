import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const config = {
  resolve: {
    alias: {
      '@': resolve(root, 'src')
    }
  },
  test: {
    environment: 'node'
  }
};

export default config;
