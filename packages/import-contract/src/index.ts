// Browser-safe barrel: the domain package and the web app import it (#90 A0),
// so the Node-only validator CLI is exposed via ./src/cli.js, not from here.
export * from './device-state.js';
export * from './format-fields.js';
