// src/adapters/index.ts
import { createExpressCancellationMiddleware, withDbCancellation as withExpressDbCancellation } from './express';
import { fastifyCancellation, withDbCancellation as withFastifyDbCancellation } from './fastify';
import { createElysiaCancellationPlugin, withDbCancellation as withElysiaDbCancellation } from './elysia';

// Re-export with specific names to avoid naming conflicts
export {
  createExpressCancellationMiddleware,
  withExpressDbCancellation,
  fastifyCancellation,
  withFastifyDbCancellation,
  createElysiaCancellationPlugin,
  withElysiaDbCancellation
};
