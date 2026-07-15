import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2023',
  clean: true,
  // @netplan/domain ships as TypeScript source (no build step of its own), so
  // bundle it into the server output — otherwise the built dist/index.js tries
  // to import the domain's .ts source at runtime and Node can't resolve it.
  // Real npm deps (zod, drizzle, better-sqlite3 native addon) stay external.
  noExternal: ['@netplan/domain'],
});
