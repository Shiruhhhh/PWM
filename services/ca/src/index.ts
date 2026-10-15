import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';
import { config, serverCertPath, serverKeyPath, caCertPath } from './config.js';

// Reads config/cert files and builds the app inside the same try/catch
// as listen() -- config.port is a getter that can throw synchronously
// on an invalid PORT env value, and readFileSync throws synchronously
// on a missing/unreadable cert file. Either must fail loudly and exit,
// not crash past the only try/catch in this file (the .catch() below
// only catches listen()'s own promise rejection).
try {
  const { port, host } = config;
  const app = buildApp({
    https: {
      cert: readFileSync(serverCertPath(), 'utf8'),
      key: readFileSync(serverKeyPath(), 'utf8'),
      ca: readFileSync(caCertPath(), 'utf8'),
      // Per docs/CA_SERVICE_SPEC.md's "internal mTLS" requirement --
      // pwm-ca only accepts connections presenting a client cert signed
      // by this same internal CA (i.e. pwm-app's bootstrap-provisioned
      // client cert). Defense in depth beyond the Proxmox firewall rule
      // that already restricts inbound to 192.168.1.10 only.
      requestCert: true,
      rejectUnauthorized: true,
    },
  });
  app.listen({ port, host }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
} catch (err) {
  // eslint-disable-next-line no-console -- app.log isn't available if buildApp() itself threw
  console.error(err);
  process.exit(1);
}
