// src/index.ts

import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import type { LibraryConfig, CancellationRegistry } from './types';
import { InMemoryCancellationRegistry } from './inMemoryCancellationRegistry';

/**
 * Initializes cancellation middleware and registry based on configuration.
 */
export function createAutoCancellationMiddleware(
  config: LibraryConfig
): { cancellationMiddleware: RequestHandler; cancellationRegistry: CancellationRegistry } {
  const {
    dbCancellationHook,
    registry: registryConfig = {},
    requestIdHeader = 'x-request-id',
    // otelTracerProvider currently unused
  } = config;

  const ttl = registryConfig.ttlSeconds;
  const cancellationRegistry = new InMemoryCancellationRegistry(dbCancellationHook, ttl);

  const cancellationMiddleware: RequestHandler = (req: any, res: any, next: any) => {
    const headerId = req.headers[requestIdHeader] as string | undefined;
    const requestId = headerId || randomUUID();
    cancellationRegistry.register(requestId);
    req.requestId = requestId;
    res.setHeader(requestIdHeader, requestId);
    req.on('close', () => {
      cancellationRegistry.markForCancellation(requestId).catch(() => {
        // ignore
      });
    });
    next();
  };

  return { cancellationMiddleware, cancellationRegistry };
}
