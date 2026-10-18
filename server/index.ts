import { createApp } from './app.js';

const { app } = await createApp({ logger: true });
const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
try {
  await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
