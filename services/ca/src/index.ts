import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();

// config.port is a getter that can throw synchronously on an invalid
// PORT env value — evaluating it inline inside the listen() call's
// argument object would throw before listen() ever runs, outside the
// only try/catch in this file (the .catch() below only catches listen()'s
// own promise rejection, not a synchronous throw while building its args).
try {
  const { port, host } = config;
  app.listen({ port, host }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
