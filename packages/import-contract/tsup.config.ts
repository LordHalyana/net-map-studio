import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  clean: true,
  // the validator must run offline as a single artifact — bundle zod in
  noExternal: ['zod'],
  banner: { js: '#!/usr/bin/env node' },
});
