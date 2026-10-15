import Fastify, { type FastifyInstance } from 'fastify';
import type { Server as HttpsServer } from 'node:https';
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

export interface BuildAppOptions {
  /**
   * HTTPS + mTLS listener options, per docs/CA_SERVICE_SPEC.md's
   * "internal mTLS" requirement. Omitted in tests (Fastify's `.inject()`
   * bypasses the real network listener regardless) and left undefined
   * falls back to plain HTTP, matching the previous behavior.
   */
  https?: {
    cert: string;
    key: string;
    ca: string;
    requestCert: boolean;
    rejectUnauthorized: boolean;
  };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance<HttpsServer> {
  // Fastify's TS overloads pick the http/https/http2 server type from
  // whether `https` is present in the options object -- buildApp's own
  // return type is the plain FastifyInstance either way (the https
  // branch is runtime-identical except for which server class Node
  // constructs internally), so the https-server generic is picked
  // explicitly here rather than relying on overload inference, which
  // would otherwise force every route handler below into a server-type
  // union depending on which branch ran.
  const app = Fastify<HttpsServer>({
    logger: true,
    https: options.https ?? null,
  }).withTypeProvider<ZodTypeProvider>();
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
