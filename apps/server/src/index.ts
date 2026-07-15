import { buildApp } from './app.js';

const app = await buildApp();

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });
app.log.info(`NetPlan Studio server listening on http://127.0.0.1:${port}`);
