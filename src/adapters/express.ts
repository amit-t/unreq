// src/adapters/express.ts
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { LibraryConfig, CancellationRegistry } from '../types';
import { createAutoCancellationMiddleware } from '../index';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Creates Express.js middleware for HTTP cancellation propagation
 * @param config Configuration for the cancellation middleware
 * @returns Object containing middleware and registry
 */
export function createExpressCancellationMiddleware(
  config: LibraryConfig
): { middleware: RequestHandler; registry: CancellationRegistry } {
  const { cancellationMiddleware, cancellationRegistry } = createAutoCancellationMiddleware(config);
  
  return {
    middleware: cancellationMiddleware,
    registry: cancellationRegistry
  };
}

/**
 * Express handler wrapper that automatically associates a database identifier with the request ID
 * @param handler The Express handler function to wrap
 * @param registry The cancellation registry
 * @param getDbIdentifier Function to extract database identifier from request
 * @returns Wrapped handler function
 */
export function withDbCancellation<P, ResBody, ReqBody, ReqQuery>(
  handler: (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response, next: NextFunction) => Promise<any>,
  registry: CancellationRegistry,
  getDbIdentifier: (req: Request<P, ResBody, ReqBody, ReqQuery>) => any
): (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response, next: NextFunction) => Promise<any> {
  return async (req, res, next) => {
    if (!req.requestId) {
      return handler(req, res, next);
    }
    
    const dbIdentifier = getDbIdentifier(req);
    if (dbIdentifier) {
      const associateResult = registry.associateDbIdentifier(req.requestId, dbIdentifier);
      if (associateResult && typeof (associateResult as Promise<void>).catch === 'function') {
        (associateResult as Promise<void>).catch((err) => {
          console.error('Failed to associate DB identifier:', err);
        });
      }
    }
    
    return handler(req, res, next);
  };
}
