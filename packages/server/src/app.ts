import { readFileSync } from 'node:fs';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { prisma } from './lib/prisma.js';
import type { App } from './types.js';
import { registerLoginParamsRoute } from './routes/loginParams.js';
import { registerRegisterRoute } from './routes/register.js';
import { registerLoginRoute } from './routes/login.js';
import { registerGetVaultRoute } from './routes/getVault.js';
import { registerPutVaultRoute } from './routes/putVault.js';
import { registerPasswordChangeRoute } from './routes/passwordChange.js';
import { registerRecoveryWrappedKeyRoute } from './routes/recoveryWrappedKey.js';
import { registerRecoveryPasswordChangeRoute } from './routes/recoveryPasswordChange.js';
import { registerCertRenewRoute } from './routes/certRenew.js';
import { registerCertRevokeRoute } from './routes/certRevoke.js';
import { registerCertInitialRoute } from './routes/certInitial.js';
import { registerAdminRoutes } from './routes/admin.js';
import { startCrlPoller } from './lib/crlPoller.js';
import { httpCaClient, type CaClient } from './lib/caClient.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Test-only override -- bypasses CA_SERVICE_URL/cert-file loading entirely. */
  caClient?: CaClient;
}

/**
 * Loads the pwm-app client cert/key and the pwm-ca-internal CA cert from
 * disk (paths from env, never committed — see .env.example) and builds the
 * mTLS-presenting CaClient. These files are provisioned once by the manual
 * bootstrap runbook (services/ca/scripts/bootstrap.sh), per CA_SERVICE_SPEC.md.
 *
 * Takes `log` (not just reads process.env blind) so a missing/unreadable
 * cert file logs a structured fatal and exits cleanly, same as every
 * other startup failure path, instead of an uncaught raw stack trace —
 * readFileSync throws synchronously and this ran before any try/catch
 * existed in the call chain.
 */
function buildCaClient(
  caServiceUrl: string,
  log: FastifyBaseLogger,
): ReturnType<typeof httpCaClient> {
  const certPath = process.env.CA_CLIENT_CERT_PATH;
  const keyPath = process.env.CA_CLIENT_KEY_PATH;
  const caPath = process.env.CA_TRUST_CERT_PATH;
  if (!certPath || !keyPath || !caPath) {
    log.fatal(
      { event: 'ca_client_config_missing' },
      'CA_SERVICE_URL set but CA_CLIENT_CERT_PATH/CA_CLIENT_KEY_PATH/CA_TRUST_CERT_PATH missing — ' +
        'pwm-ca requires mTLS, see docs/CA_SERVICE_SPEC.md bootstrap step.',
    );
    process.exit(1);
  }

  try {
    return httpCaClient(caServiceUrl, {
      certPem: readFileSync(certPath, 'utf8'),
      keyPem: readFileSync(keyPath, 'utf8'),
      caPem: readFileSync(caPath, 'utf8'),
    });
  } catch (err) {
    log.fatal(
      { event: 'ca_client_cert_load_failed', err },
      'failed to read pwm-ca mTLS cert/key files',
    );
    process.exit(1);
  }
}

export function buildApp(options: BuildAppOptions = {}): App {
  const app: App = Fastify({
    logger: options.logger ?? true,
  }).withTypeProvider<import('fastify-type-provider-zod').ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('prisma', prisma);

  // Strict per-IP + per-username limits on pre-session-token endpoints,
  // per docs/API_SPEC.md "Rate limiting". Per-route overrides set the
  // tighter effective limit; this is the app-wide fallback.
  app.register(rateLimit, {
    global: false,
  });

  registerLoginParamsRoute(app);
  registerRegisterRoute(app);
  registerLoginRoute(app);
  registerGetVaultRoute(app);
  registerPutVaultRoute(app);
  registerPasswordChangeRoute(app);
  registerRecoveryWrappedKeyRoute(app);
  registerRecoveryPasswordChangeRoute(app);

  const caServiceUrl = process.env.CA_SERVICE_URL;
  const caClient =
    options.caClient ?? (caServiceUrl ? buildCaClient(caServiceUrl, app.log) : undefined);
  registerCertRenewRoute(app, caClient);
  registerCertRevokeRoute(app, caClient);
  registerCertInitialRoute(app, caClient);
  registerAdminRoutes(app, caClient);

  app.get('/health', async () => ({ status: 'ok' }));

  if (caServiceUrl) {
    const poller = startCrlPoller({ caServiceUrl, logger: app.log });
    app.addHook('onClose', () => {
      poller.stop();
    });
  }

  if (caClient) {
    app.addHook('onClose', async () => {
      await caClient.close();
    });
  }

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}
