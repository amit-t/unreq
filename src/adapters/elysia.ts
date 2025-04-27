// src/adapters/elysia.ts
import { randomUUID } from 'crypto';
import { LibraryConfig, CancellationRegistry } from '../types';
import { createCancellationRegistry } from '../index';
import { OTelIntegration } from '../otel';

/**
 * Creates an Elysia plugin for HTTP cancellation propagation
 * @param options Configuration options
 * @returns A plugin function to be used with Elysia app.use()
 */
export function createElysiaCancellationPlugin(options: LibraryConfig) {
  const {
    requestIdHeader = 'x-request-id',
    otelTracerProvider
  } = options;

  const cancellationRegistry = createCancellationRegistry(options);
  const otel = otelTracerProvider ? new OTelIntegration() : null;

  // Expose the registry so it can be used elsewhere in the app
  const plugin = (app: any) => {
    app.store.cancellationRegistry = cancellationRegistry;
    
    // Add the request handling middleware
    app.derive(({ request, set }: any) => {
      const headerId = request.headers.get(requestIdHeader.toLowerCase());
      const requestId = headerId || randomUUID();
      
      // Register the request ID
      if (typeof cancellationRegistry.register === 'function') {
        const registerResult = cancellationRegistry.register(requestId);
        if (registerResult && typeof (registerResult as Promise<void>).catch === 'function') {
          (registerResult as Promise<void>).catch((err) => {
            console.error('Failed to register request ID:', err);
          });
        }
      }
      
      // Set response header
      set.headers[requestIdHeader] = requestId;
      
      // Create span for OpenTelemetry if available
      if (otel) {
        otel.createRequestSpan(
          requestId, 
          request.method, 
          request.url
        );
      }
      
      // Handle request aborted - Elysia uses Bun, so we need to listen to aborted event
      request.signal.addEventListener('abort', () => {
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
      
      // Return requestId to be available in the handlers
      return {
        requestId
      };
    });
    
    // Add afterHandle hook for cleanup
    app.onAfterHandle(({ requestId, set }: any) => {
      if (!requestId) return;
      
      if (otel) {
        otel.endRequestSpan(requestId, set.status);
      }
      
      const finishResult = cancellationRegistry.markAsFinished(requestId);
      if (finishResult && typeof (finishResult as Promise<void>).catch === 'function') {
        (finishResult as Promise<void>).catch((err) => {
          console.error('Failed to mark request as finished:', err);
        });
      }
    });
    
    return app;
  };

  // Add metadata to the plugin
  plugin.registry = cancellationRegistry;
  
  return plugin;
}

/**
 * Helper to associate a database identifier with the current request
 */
export function withDbCancellation(handler: (context: any) => Promise<any>, getDbIdentifier: (context: any) => any) {
  return async (context: any) => {
    const { requestId } = context;
    const { cancellationRegistry } = context.app.store;
    
    if (!requestId || !cancellationRegistry) {
      return handler(context);
    }
    
    const dbIdentifier = getDbIdentifier(context);
    if (dbIdentifier) {
      const associateResult = cancellationRegistry.associateDbIdentifier(requestId, dbIdentifier);
      if (associateResult && typeof (associateResult as Promise<void>).catch === 'function') {
        (associateResult as Promise<void>).catch((err) => {
          console.error('Failed to associate DB identifier:', err);
        });
      }
    }
    
    return handler(context);
  };
}
