import type { App } from '../types.js';
import { z } from 'zod';
import { putVaultRequestSchema, revisionConflictResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { logVaultAccess } from '../lib/logger.js';

/**
 * PUT /vault (session required) — expectedRevision mismatch -> 409 +
 * current revision (client refetches, merges, retries), per
 * docs/API_SPEC.md. Match -> write, increment revision, update updated_at.
 */
export function registerPutVaultRoute(app: App): void {
  app.put(
    '/vault',
    {
      preHandler: requireSession,
      schema: {
        body: putVaultRequestSchema,
        response: {
          204: z.null(),
          404: z.object({ error: z.string() }),
          409: revisionConflictResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const { encryptedBlob, expectedRevision, blobFormatVersion } = request.body;

      const current = await prisma.vaultBlob.findUnique({ where: { userId } });
      if (!current) {
        return reply.code(404).send({ error: 'vault not found' });
      }

      if (current.revision !== expectedRevision) {
        return reply.code(409).send({ currentRevision: current.revision });
      }

      const updated = await prisma.vaultBlob.update({
        where: { userId },
        data: {
          encryptedBlob: Buffer.from(encryptedBlob, 'base64'),
          blobFormatVersion,
          revision: current.revision + 1,
          updatedAt: new Date(),
        },
      });

      logVaultAccess(request.log, {
        userId,
        operation: 'write',
        revision: updated.revision,
      });

      return reply.code(204).send(null);
    },
  );
}
