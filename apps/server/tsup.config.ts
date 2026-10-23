import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/imports/parse-worker.ts'],
  format: ['esm'],
  target: 'es2023',
  clean: true,
  // @netplan/domain and @netplan/import-contract export TypeScript source, so
  // bundle them into the server output — otherwise the built dist/index.js
  // tries to import their .ts source at runtime and Node can't resolve it.
  // Real npm deps (zod, drizzle, better-sqlite3 native addon) stay external.
  noExternal: ['@netplan/domain', '@netplan/import-contract'],
});
