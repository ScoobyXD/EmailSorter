import { loadConfig } from './config.ts';
import { makeClassifier } from './classification.ts';
import { createHelperServer, PORT } from './server.ts';
import { fileURLToPath } from 'node:url';

try {
  const config = await loadConfig();
  const logDirectory = fileURLToPath(new URL('../.private/run-logs/', import.meta.url));
  const server = createHelperServer({ ...config, classify: makeClassifier(config.apiKey, config.model), logDirectory });
  server.on('error', () => {
    console.error(`Dock helper could not bind 127.0.0.1:${PORT}. Check whether another helper is already running.`);
    process.exitCode = 1;
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Dock helper ready at http://127.0.0.1:${PORT}. Keep this window open while categorizing.`);
    console.log('No Gmail emails are processed until you click Categorize emails in Dock.');
    console.log(`Run logs are saved to ${logDirectory}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Dock helper failed to start.');
  process.exitCode = 1;
}
