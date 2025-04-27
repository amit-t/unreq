## **Development Plan: HTTP Cancellation Propagation & Tracing Library (Auto-Detection & Configurable)**

**1\. Introduction & Goals**

This document outlines the development plan for a Node.js npm library, written in TypeScript, designed to facilitate the propagation of HTTP request cancellation signals from the client through backend services down to the database layer. This version focuses on **automatically detecting client request abortion** (e.g., connection closed) on the server side to trigger cancellation, features a **user-configurable cancellation registry (In-Memory or Redis)**, and supports user-provided cancellation logic for various databases. A primary goal is seamless integration with popular Node.js HTTP server frameworks (Express, Fastify, Elysia) and built-in observability via OpenTelemetry (OTel).

**Core Goals:**

* Provide middleware/hooks for easy integration into existing Node.js HTTP applications.  
* Automate the extraction and propagation of a unique Request ID.  
* **Automatically detect** when a client aborts/closes the connection for an ongoing request.  
* Offer a standardized mechanism for backend services to **react to the detected cancellation** and potentially terminate associated long-running database operations for that specific request.  
* Provide a **configurable Cancellation Registry**, defaulting to in-memory, with an option to use Redis for distributed environments.  
* Integrate OpenTelemetry tracing to provide visibility into the request lifecycle, including cancellation events triggered by connection closure.  
* Abstract database-specific cancellation logic via a **Database Cancellation Hook**, allowing users to plug in their own implementation tailored for databases like **PostgreSQL, MySQL, MongoDB, Cassandra, Redis**, and others.  
* Prioritize developer experience with clear documentation and simple configuration.

**2\. Core Features**

* **Request ID & Cancellation Detection Middleware:** Automatically extracts/generates a unique Request ID. Attaches listeners to the incoming request object (e.g., req.on('close')) to detect client disconnection. Makes the Request ID accessible throughout the request lifecycle.  
* **Configurable Cancellation Registry:** An internal mechanism to track active requests.  
  * **Type:** User-configurable to be either in-memory (default, suitable for single-instance deployments) or redis (suitable for distributed systems).  
  * **Functionality:** Tracks Request IDs, associated cancellation status, and database identifiers. Status is updated automatically upon detected request closure.  
* **Database Cancellation Hook:** A defined interface or callback mechanism where users provide an async function to execute the actual database operation cancellation. This hook is triggered by the registry when cancellation is detected for a request associated with a database identifier. The design supports implementing cancellation logic for various databases, including but not limited to:  
  * **PostgreSQL** (e.g., using pg\_cancel\_backend)  
  * **MySQL** (e.g., using KILL QUERY)  
  * **MongoDB** (e.g., using db.killOp())  
  * **Cassandra** (Requires application-level tracking; Cassandra itself doesn't typically support direct query cancellation)  
  * **Redis** (e.g., potentially interrupting long-running Lua scripts or managing application-level locks)  
* **OpenTelemetry Integration:** Automatically creates spans, adds cancellation-related events/attributes, and propagates context.  
* **Framework Adapters:** Specific middleware/plugin implementations for Express, Fastify, and Elysia.  
* **Configuration:** Allow users to configure:  
  * Request ID header name.  
  * **Cancellation Registry type (in-memory or redis)**.  
  * **Redis connection options** (if redis type is selected).  
  * Registry behavior (e.g., entry TTL).  
  * The DbCancellationHook function.  
  * OpenTelemetry TracerProvider.

**3\. Architecture & Key Components**

\+-------------------+      \+---------------------------------+      \+------------------------+  
|   HTTP Framework  |-----\>| Library Middleware/Hook         |-----\>| User's Route Handler   |  
| (Express/Fastify) |      | (ReqID, OTel Span, Close Listener)|    | (Accesses ReqID)       |  
\+-------------------+      \+---------------------------------+      \+------------------------+  
        |                          |   Detects req.on('close')         |  
        |                          |   event                       | Calls DB Operation  
        |                          v                                v  
        |      \+------------------------------------------------+  \+------------------------+  
        |      | Cancellation Registry                          |  | DB Cancellation Hook   |  
        |      | (Type: In-Memory \[Default\] / Redis)            |\<-+ (User Provided Func  |  
        |      | \- Maps ReqID \-\> { status, dbInfo, ttl }        |  | for PG/MySQL/Mongo/etc)|  
        |      | \- Configurable via options (e.g., Redis client)|  \+------------------------+  
        |      \+------------------------------------------------+           |  
        |                          ^                                        | Executes DB Command  
        |                          | Triggers Hook                          v  
        \+--------------------------+                               \+------------------------+  
                                                                   | Database (e.g., PG/MySQL)|  
                                                                   \+------------------------+

* **RequestIdCancellationMiddleware:** (Functionality remains the same \- detects closure, manages ReqID, OTel span, calls registry)  
* **CancellationRegistry:**  
  * An **interface** defining methods like register, markForCancellation, associateDbIdentifier, getStatus, markAsFinished, cleanup.  
  * **Two concrete implementations provided by the library:**  
    * InMemoryCancellationRegistry: Default implementation using a JavaScript Map or similar. Suitable for single-process applications.  
    * RedisCancellationRegistry: Implementation using a Redis client (like ioredis or node-redis). Requires Redis connection options during configuration. Stores registry entries in Redis with appropriate TTLs.  
  * Stores mapping: requestId \-\> { status: 'active' | 'cancelling' | 'cancelled' | 'finished', dbIdentifier: any }.  
  * Handles triggering the DbCancellationHook when markForCancellation is called on an entry with a dbIdentifier.  
* **DbCancellationHook:**  
  * An **interface** defined by the library: (requestId: string, dbIdentifier: any) \=\> Promise\<boolean\>.  
  * The user **must provide** a concrete function implementing this interface, containing the logic specific to their database (PostgreSQL, MySQL, MongoDB, etc.) and how they identify cancellable operations (dbIdentifier).  
* **OpenTelemetryIntegration:** (No fundamental change)  
* **FrameworkAdapters:** (No fundamental change, ensure registry instance is correctly passed/accessible)  
* **Configuration:**  
  * Expanded configuration object/function:  
    interface LibraryConfig {  
      requestIdHeader?: string;  
      dbCancellationHook: (requestId: string, dbIdentifier: any) \=\> Promise\<boolean\>;  
      registry?: {  
        type?: 'in-memory' | 'redis'; // Default: 'in-memory'  
        ttlSeconds?: number; // Default: e.g., 3600  
        redisOptions?: Redis.RedisOptions | string; // e.g., connection string or ioredis options  
        redisClient?: Redis.Redis; // Optional: Provide an existing client instance  
      };  
      otelTracerProvider?: TracerProvider;  
    }

**4\. Business Logic Flow (Automatic Cancellation Process)**

(The core flow remains the same as the previous version. The key difference is that the specific CancellationRegistry implementation (In-Memory or Redis) used in steps 1, 5, 7, and 8 is determined by the user's configuration.)

1. **Initial Request:** Middleware runs, registers ReqID in the configured CancellationRegistry (In-Memory or Redis). Attaches close listener.  
2. **Start Cancellable DB Operation:** User code calls associateDbIdentifier on the configured registry instance.  
3. **Client Aborts Request:** Connection closes.  
4. **Server Detects Closure:** close listener fires, calls markForCancellation on the configured registry instance.  
5. **Registry & Hook Trigger:** The configured registry (In-Memory or Redis) updates status, retrieves dbIdentifier, and invokes the user-provided DbCancellationHook.  
6. **Database Cancellation Execution:** User's hook function runs (specific logic for PG/MySQL/Mongo/etc.).  
7. **Registry Update & Cleanup:** Configured registry updates status based on hook result. Entry eventually expires (TTL managed by In-Memory logic or Redis EXPIRE).  
8. **Normal Completion:** User code/adapter calls markAsFinished on the configured registry instance before sending the response.

**5\. Technology Stack & Tooling**

* Language: TypeScript  
* Runtime: Node.js (LTS versions)  
* Core Dependencies: @opentelemetry/api, @opentelemetry/sdk-node, @opentelemetry/instrumentation-http, uuid.  
* **Optional Dependencies:** ioredis or redis (needed only if using redis registry type).  
* Optional Peer Dependencies: express, fastify, elysia.  
* Build Tool: tsc.  
* Bundler (Optional): tsup, rollup, or esbuild.  
* Testing: Jest, Vitest, or Node Test Runner; Supertest.  
* Linting/Formatting: ESLint, Prettier.  
* Package Manager: npm or yarn.

**6\. Development Phases/Roadmap**

1. **Phase 1: Project Setup & Core Types (Est. 1-2 days)**  
   * Setup project, TS, testing, linting.  
   * Define core interfaces (CancellationRegistry, DbCancellationHook, LibraryConfig).  
   * Basic OTel setup.  
2. **Phase 2: Core Logic & In-Memory Registry (Est. 4-5 days)**  
   * Implement RequestIdCancellationMiddleware with close handling.  
   * Implement InMemoryCancellationRegistry.  
   * Integrate basic OTel span/event creation.  
3. **Phase 3: Redis Registry Implementation (Est. 2-3 days)**  
   * Implement RedisCancellationRegistry using ioredis or redis.  
   * Handle Redis connection options and client injection.  
   * Ensure TTL management in Redis.  
4. **Phase 4: Database Hook Integration & Refinement (Est. 2-3 days)**  
   * Refine registry implementations to correctly handle dbIdentifier association and trigger the hook.  
   * Integrate the calling mechanism for the user-provided DbCancellationHook.  
   * Define clear examples/guidance for implementing hooks for **PostgreSQL, MySQL, MongoDB**. Add notes on challenges/strategies for Cassandra/Redis.  
5. **Phase 5: Framework Adapters (Est. 4-5 days)**  
   * Develop adapters for Express, Fastify, Elysia.  
   * Ensure adapters correctly instantiate/pass the configured CancellationRegistry instance.  
   * Ensure adapters facilitate calling markAsFinished.  
6. **Phase 6: Testing & Refinement (Est. 6-8 days)**  
   * Unit tests for both registry implementations.  
   * Integration tests for each framework adapter, testing **both in-memory and Redis registry configurations**.  
   * Simulate client disconnections.  
   * Verify DbCancellationHook calls with mocked hooks.  
   * Verify OTel output.  
   * Test edge cases (Redis connection errors, hook failures).  
7. **Phase 7: Documentation & Examples (Est. 3-4 days)**  
   * Write comprehensive README covering:  
     * Installation, Configuration (**including registry type and Redis options**).  
     * Automatic cancellation behavior.  
     * API Reference.  
     * **Detailed guidance and examples for implementing DbCancellationHook for PostgreSQL, MySQL, MongoDB**, and strategies for others.  
     * Usage examples for each framework.  
     * OTel setup.  
   * Create example projects.  
8. **Phase 8: Packaging & Publishing (Est. 1 day)**  
   * Configure package.json (including optionalDependencies for Redis client).  
   * Build distributable files.  
   * Publish to npm.

**7\. Integration Strategy**

Users will integrate the library, configuring the registry and providing the DB hook:

// Example (Conceptual Express with Redis Registry)  
import express from 'express';  
import { createAutoCancellationMiddleware } from 'my-cancel-lib/express';  
import { myPostgresCancelFunction } from './db-cancel-pg'; // User's PG implementation  
import { tracerProvider } from './otel-setup'; // User's OTel setup  
// import Redis from 'ioredis'; // If providing own client

const app \= express();

// 1\. Configure the library (using Redis Registry)  
const { cancellationMiddleware, cancellationRegistry } \= createAutoCancellationMiddleware({  
  // Hook specific to the database being used in the cancellable route  
  dbCancellationHook: myPostgresCancelFunction,  
  registry: {  
    type: 'redis',  
    // Option 1: Provide connection string/options  
    redisOptions: process.env.REDIS\_URL || 'redis://localhost:6379',  
    // Option 2: Provide an existing ioredis client instance  
    // redisClient: new Redis(process.env.REDIS\_URL),  
    ttlSeconds: 60 \* 60 // Optional: Override default TTL  
  },  
  otelTracerProvider: tracerProvider // Optional  
});

// 2\. Apply the middleware early  
app.use(cancellationMiddleware);

// 3\. User's routes  
app.post('/some-postgres-query', async (req, res) \=\> {  
  const requestId \= req.requestId;  
  let responseSent \= false;  
  try {  
    console.log(\`Starting PG query for request ID: ${requestId}\`);  
    // \--\> Associate PG-specific identifier (e.g., PID) \<--  
    const dbInfo \= { pid: await getPostgresBackendPid() }; // User function to get PID  
    await cancellationRegistry.associateDbIdentifier(requestId, dbInfo);

    const results \= await executeLongPostgresQuery(); // Might be cancelled by the hook

    responseSent \= true;  
    await cancellationRegistry.markAsFinished(requestId);  
    res.json(results);

  } catch (error) {  
     // Handle errors, check if due to cancellation...  
     if (\!responseSent) {  
        const status \= await cancellationRegistry.getStatus(requestId);  
         if (status.status \=== 'cancelling' || status.status \=== 'cancelled') {  
            console.log(\`PG Operation for ${requestId} failed likely due to client cancellation.\`);  
            return; // Client gone  
         } else {  
             // Handle other errors  
         }  
     }  
     // ... error handling ...  
  } finally {  
     // ... cleanup logging ...  
  }  
});

app.get('/quick-info', async (req, res) \=\> {  
    // ... (same as before, uses configured registry implicitly) ...  
    await cancellationRegistry.markAsFinished(req.requestId);  
});

// OTel setup and server start...

**8\. Testing Strategy**

* Unit Tests: Test InMemoryCancellationRegistry and RedisCancellationRegistry independently. Mock Redis client for the latter.  
* Integration Tests:  
  * Run tests against **both registry types**. Use an embedded Redis or Docker for Redis tests.  
  * Simulate client disconnections.  
  * Verify hook calls and OTel output for both registry configurations.  
* End-to-End Tests: Test against real databases (PG, MySQL, potentially Mongo) to verify cancellation via the user hook.

**9\. Documentation**

* **README.md:** Must clearly document:  
  * How to configure the registry.type (in-memory vs redis).  
  * Required redisOptions or redisClient when using Redis.  
  * Detailed examples for implementing DbCancellationHook for **PostgreSQL, MySQL, MongoDB**, including how to get relevant identifiers (PID, thread ID, op ID).  
  * Discussion of challenges/approaches for **Cassandra** (likely requires app-level task tracking) and **Redis** (e.g., CLIENT KILL TYPE normal, Lua script interruption \- noting limitations).  
* **Typedoc:** API documentation.  
* **Example Projects:** Include examples demonstrating both in-memory and Redis configurations.

**10\. Packaging & Publishing**

* Configure package.json. Add Redis client (ioredis or redis) to optionalDependencies.  
* Build distributables.  
* Publish to npm.