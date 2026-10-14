import Fastify from 'fastify';
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
import { registerCertRenewRoute } from './routes/certRenew.js';
import { registerCertRevokeRoute } from './routes/certRevoke.js';
import { startCrlPoller } from './lib/crlPoller.js';
import { httpCaClient } from './lib/caClient.js';

export interface BuildAppOptions {
  logger?: boolean;
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

  const caServiceUrl = process.env.CA_SERVICE_URL;
  const caClient = caServiceUrl ? httpCaClient(caServiceUrl) : undefined;
  registerCertRenewRoute(app, caClient);
  registerCertRevokeRoute(app, caClient);

  app.get('/health', async () => ({ status: 'ok' }));

  if (caServiceUrl) {
    const poller = startCrlPoller({ caServiceUrl, logger: app.log });
    app.addHook('onClose', () => {
      poller.stop();
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
