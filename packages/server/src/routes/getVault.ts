import type { App } from '../types.js';
import { z } from 'zod';
import { getVaultResponseSchema } from '@pwm/core';
import { prisma } from '../lib/prisma.js';
import { requireSession } from '../lib/requireSession.js';
import { logVaultAccess } from '../lib/logger.js';

/** GET /vault (session required) per docs/API_SPEC.md. */
export function registerGetVaultRoute(app: App): void {
  app.get(
    '/vault',
    {
      preHandler: requireSession,
      schema: {
        response: {
          200: getVaultResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId!;
      const vaultBlob = await prisma.vaultBlob.findUnique({ where: { userId } });

      if (!vaultBlob) {
        return reply.code(404).send({ error: 'vault not found' });
      }

      logVaultAccess(request.log, {
        userId,
        operation: 'read',
        revision: vaultBlob.revision,
      });

      return {
        encryptedBlob: Buffer.from(vaultBlob.encryptedBlob).toString('base64'),
        revision: vaultBlob.revision,
        blobFormatVersion: vaultBlob.blobFormatVersion,
      };
    },
  );
}
