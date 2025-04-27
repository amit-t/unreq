// src/index.ts

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { LibraryConfig, CancellationRegistry, DbCancellationHook } from './types';
import { InMemoryCancellationRegistry } from './inMemoryCancellationRegistry';
import { RedisCancellationRegistry } from './redisCancellationRegistry';
import { OTelIntegration } from './otel';

export * from './types';
export { InMemoryCancellationRegistry } from './inMemoryCancellationRegistry';
export { RedisCancellationRegistry } from './redisCancellationRegistry';
export { OTelIntegration } from './otel';
export * from './adapters';
export * from './examples';

interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Creates a cancellation registry based on configuration
 */
export function createCancellationRegistry(
  config: LibraryConfig
): CancellationRegistry {
  const {
    dbCancellationHook,
    registry: registryConfig = {}
  } = config;

  const ttl = registryConfig.ttlSeconds;
  const registryType = registryConfig.type || 'in-memory';

  if (registryType === 'redis') {
    if (!registryConfig.redisClient) {
      throw new Error('Redis client must be provided when using redis registry type');
    }
    return new RedisCancellationRegistry(dbCancellationHook, registryConfig.redisClient, ttl);
  }

  return new InMemoryCancellationRegistry(dbCancellationHook, ttl);
}

/**
 * Initializes cancellation middleware and registry based on configuration.
 */
export function createAutoCancellationMiddleware(
  config: LibraryConfig
): { cancellationMiddleware: RequestHandler; cancellationRegistry: CancellationRegistry } {
  const {
    requestIdHeader = 'x-request-id',
    otelTracerProvider
  } = config;

  const cancellationRegistry = createCancellationRegistry(config);
  const otel = otelTracerProvider ? new OTelIntegration() : null;

  const cancellationMiddleware: RequestHandler = (req: RequestWithId, res: Response, next: NextFunction) => {
    const headerId = req.headers[requestIdHeader.toLowerCase()] as string | undefined;
    const requestId = headerId || randomUUID();
    
    // Register the request ID
    if ('register' in cancellationRegistry && typeof cancellationRegistry.register === 'function') {
      const registerResult = cancellationRegistry.register(requestId);
      if (registerResult && typeof (registerResult as Promise<void>).catch === 'function') {
        (registerResult as Promise<void>).catch((err) => {
          console.error('Failed to register request ID:', err);
        });
      }
    }
    
    // Set request ID on request object
    req.requestId = requestId;
    res.setHeader(requestIdHeader, requestId);
    
    // Create span for OpenTelemetry if available
    if (otel) {
      otel.createRequestSpan(requestId, req.method, req.url);
    }
    
    // Listen for client disconnect
    req.on('close', () => {
      if (otel) {
        otel.markRequestCancelled(requestId);
      }
      
      const cancelResult = cancellationRegistry.markForCancellation(requestId);
      if (cancelResult && typeof (cancelResult as Promise<void>).catch === 'function') {
        (cancelResult as Promise<void>).catch((err) => {
          console.error('Failed to mark request for cancellation:', err);
        });
      }
    });
    
    // Add a listener for response finish
    res.on('finish', () => {
      if (otel) {
        otel.endRequestSpan(requestId, res.statusCode);
      }
      
      const finishResult = cancellationRegistry.markAsFinished(requestId);
      if (finishResult && typeof (finishResult as Promise<void>).catch === 'function') {
        (finishResult as Promise<void>).catch((err) => {
          console.error('Failed to mark request as finished:', err);
        });
      }
    });
    
    next();
  };

  return { cancellationMiddleware, cancellationRegistry };
}
