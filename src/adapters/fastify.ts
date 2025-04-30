// src/adapters/fastify.ts
import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { LibraryConfig, CancellationRegistry } from "../types";
import { createCancellationRegistry } from "../index";
import { OTelIntegration } from "../otel";
// biome-ignore lint/style/useNodejsImportProtocol: <explanation>
import { randomUUID } from "crypto";

declare module "fastify" {
  interface FastifyInstance {
    cancellationRegistry: CancellationRegistry;
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    associateDbIdentifier(requestId: string, dbIdentifier: any): Promise<void>;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

// Make all properties optional to satisfy FastifyPluginCallback constraint
export interface FastifyCancellationOptions {
  dbCancellationHook?: LibraryConfig["dbCancellationHook"];
  registry?: LibraryConfig["registry"];
  otelTracerProvider?: LibraryConfig["otelTracerProvider"];
  requestIdHeader?: string;
}

/**
 * Fastify plugin for HTTP cancellation propagation
 */
export const fastifyCancellation = fp(
  (fastify: FastifyInstance, options: FastifyCancellationOptions, done: (err?: Error) => void) => {
    const {
      requestIdHeader = "x-request-id",
      otelTracerProvider,
      registry: registryConfig,
      dbCancellationHook,
    } = options;

    // Ensure we have the required properties for LibraryConfig
    if (!dbCancellationHook) {
      return done(new Error("dbCancellationHook is required"));
    }

    // Create a compatible LibraryConfig object
    const config: LibraryConfig = {
      dbCancellationHook,
      registry: registryConfig,
      requestIdHeader,
      otelTracerProvider,
    };

    const cancellationRegistry = createCancellationRegistry(config);
    const otel = otelTracerProvider ? new OTelIntegration() : null;

    // Make registry accessible via app instance
    fastify.decorate("cancellationRegistry", cancellationRegistry);

    // Add the request handling hook
    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      const headerId = request.headers[requestIdHeader.toLowerCase()] as string | undefined;
      const requestId = headerId || randomUUID();

      // Register the request ID
      if (typeof cancellationRegistry.register === "function") {
        try {
          await Promise.resolve(cancellationRegistry.register(requestId));
        } catch (err) {
          request.log.error({ err }, "Failed to register request ID");
        }
      }

      // Set request ID on request object and response header
      request.requestId = requestId;
      reply.header(requestIdHeader, requestId);

      // Create span for OpenTelemetry if available
      if (otel) {
        otel.createRequestSpan(requestId, request.method, request.url);
      }

      // Handle request close event
      request.raw.on("close", async () => {
        if (otel) {
          otel.markRequestCancelled(requestId);
        }

        try {
          await Promise.resolve(cancellationRegistry.markForCancellation(requestId));
        } catch (err) {
          request.log.error({ err }, "Failed to mark request for cancellation");
        }
      });
    });

    // Add the response handling hook
    fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.requestId;

      if (otel) {
        otel.endRequestSpan(requestId, reply.statusCode);
      }

      try {
        await Promise.resolve(cancellationRegistry.markAsFinished(requestId));
      } catch (err) {
        request.log.error({ err }, "Failed to mark request as finished");
      }
    });

    // Helper method to associate DB identifier
    // biome-ignore lint/suspicious/noExplicitAny: following interface definition in types.ts
    fastify.decorate("associateDbIdentifier", async (requestId: string, dbIdentifier: any) => {
      try {
        await Promise.resolve(cancellationRegistry.associateDbIdentifier(requestId, dbIdentifier));
      } catch (err) {
        fastify.log.error({ err, requestId }, "Failed to associate DB identifier");
      }
    });

    done();
  },
  {
    name: "fastify-cancellation",
    fastify: "4.x",
  }
);

/**
 * Helper to associate a database identifier with the current request
 */
export function withDbCancellation<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  getDbIdentifier: (request: FastifyRequest) => any
): (request: FastifyRequest, reply: FastifyReply) => Promise<T> {
  return async (request, reply) => {
    const requestId = request.requestId;
    const dbIdentifier = getDbIdentifier(request);

    if (requestId && dbIdentifier && request.server.cancellationRegistry) {
      try {
        await Promise.resolve(
          request.server.cancellationRegistry.associateDbIdentifier(requestId, dbIdentifier)
        );
      } catch (err) {
        request.log.error({ err }, "Failed to associate DB identifier");
      }
    }

    return handler(request, reply);
  };
}
