import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { readCrl, appendRevocation, appendIssuanceLog, crlVersion } from './storage.js';
import { signCsr, WeakKeyError, InvalidCsrError } from './openssl.js';
import {
  signRequestSchema,
  signResponseSchema,
  revokeRequestSchema,
  revokeResponseSchema,
  crlResponseSchema,
  healthResponseSchema,
  errorResponseSchema,
} from './schemas.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok' as const,
  }));

  app.post(
    '/sign',
    {
      schema: {
        body: signRequestSchema,
        response: { 200: signResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { csr, deviceCn } = request.body;
      try {
        const signed = await signCsr(csr, deviceCn);
        await appendIssuanceLog({
          cn: deviceCn,
          fingerprint: signed.fingerprint,
          issuedAt: new Date().toISOString(),
          expiresAt: signed.expiresAt,
        });
        return reply.code(200).send({
          cert: signed.certPem,
          fingerprint: signed.fingerprint,
          expiresAt: signed.expiresAt,
        });
      } catch (err) {
        if (err instanceof WeakKeyError || err instanceof InvalidCsrError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    '/revoke',
    {
      schema: {
        body: revokeRequestSchema,
        response: { 200: revokeResponseSchema },
      },
    },
    async (request, reply) => {
      const entries = await appendRevocation({
        fingerprint: request.body.fingerprint,
        revokedAt: new Date().toISOString(),
      });
      return reply.code(200).send({ crlVersion: crlVersion(entries) });
    },
  );

  app.get('/crl', { schema: { response: { 200: crlResponseSchema } } }, async () => readCrl());

  return app;
}
