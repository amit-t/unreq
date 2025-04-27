# Unreq

Automatic HTTP Request Cancellation Propagation for Node.js servers. Detect client disconnections, manage cancellable operations, and cleanly integrate with your database and observability tools.

[![Built with TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-blue)](https://www.typescriptlang.org/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Features

- **Automatic Cancellation Detection**: Detects when clients abort HTTP requests on the server side
- **Configurable Cancellation Registry**: Choose between in-memory (default) or Redis for distributed systems
- **Database Cancellation Integration**: Includes hooks and utilities for PostgreSQL, MySQL, and MongoDB
- **Framework Support**: Ready-to-use adapters for Express, Fastify, and Elysia
- **OpenTelemetry Integration**: Built-in tracing for observability

## Installation

```bash
pnpm add unreq

# For Redis registry (optional)
pnpm add ioredis

# For PostgreSQL hook (optional)
pnpm add pg

# For MySQL hook (optional)
pnpm add mysql2

# For MongoDB hook (optional)
pnpm add mongodb
```

## Quick Start

### Express Example

```typescript
import express from 'express';
import { createExpressCancellationMiddleware, withExpressDbCancellation, createPostgresCancellationHook } from 'unreq';
import { Pool } from 'pg';

const app = express();
const pool = new Pool();

// 1. Create the cancellation hook specific to your database
const pgCancelHook = createPostgresCancellationHook(pool);

// 2. Configure middleware with in-memory registry (default)
const { middleware, registry } = createExpressCancellationMiddleware({
  dbCancellationHook: pgCancelHook,
  requestIdHeader: 'x-request-id' // optional, default value
});

// 3. Apply middleware early
app.use(middleware);

// 4. Define routes with DB cancellation support
app.get('/api/long-query', withExpressDbCancellation(
  async (req, res) => {
    const client = await pool.connect();
    try {
      // Execute a query that might take a long time
      const result = await client.query('SELECT pg_sleep(30), * FROM large_table');
      res.json(result.rows);
    } finally {
      client.release();
    }
  },
  registry,
  async (req) => {
    // Get the PostgreSQL backend PID to identify the query process
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT pg_backend_pid()'); 
      return { pid: result.rows[0].pg_backend_pid };
    } finally {
      client.release();
    }
  }
));

app.listen(3000);
```

### Using Redis Registry for Distributed Systems

```typescript
import { createExpressCancellationMiddleware } from 'unreq';
import Redis from 'ioredis';

const redisClient = new Redis('redis://localhost:6379');

const { middleware, registry } = createExpressCancellationMiddleware({
  dbCancellationHook: myDbCancelHook,
  registry: {
    type: 'redis',
    redisClient: redisClient,
    ttlSeconds: 3600 // Optional: override default TTL
  }
});
```

## Framework Support

### Fastify

```typescript
import Fastify from 'fastify';
import { fastifyCancellation, withFastifyDbCancellation } from 'unreq';

const fastify = Fastify();

// Register the plugin
fastify.register(fastifyCancellation, {
  dbCancellationHook: myDbCancelHook
});

// Use with cancelable route
fastify.get('/api/query', withFastifyDbCancellation(
  async (request, reply) => {
    // Handle request
    return { result: 'data' };
  },
  (request) => {
    // Return database identifier
    return { id: 'db-operation-id' };
  }
));
```

### Elysia (Bun)

```typescript
import { Elysia } from 'elysia';
import { createElysiaCancellationPlugin, withElysiaDbCancellation } from 'unreq';

const app = new Elysia();

// Create and use the plugin
const cancellationPlugin = createElysiaCancellationPlugin({
  dbCancellationHook: myDbCancelHook
});

app.use(cancellationPlugin);

// Use with cancelable route
app.get('/api/query', withElysiaDbCancellation(
  async (context) => {
    // Handle request
    return { result: 'data' };
  },
  (context) => {
    // Return database identifier
    return { id: 'db-operation-id' };
  }
));
```

## Database Hooks

The library includes ready-made hooks for popular databases:

### PostgreSQL

```typescript
import { Pool } from 'pg';
import { createPostgresCancellationHook, getPostgresBackendPid } from 'unreq';

const pool = new Pool();
const pgCancelHook = createPostgresCancellationHook(pool);

// Later, get the backend PID to associate with a request
const client = await pool.connect();
try {
  const pid = await getPostgresBackendPid(client);
  await registry.associateDbIdentifier(requestId, { pid });
  // Run your query...
} finally {
  client.release();
}
```

### MySQL

```typescript
import mysql from 'mysql2/promise';
import { createMySqlCancellationHook, getMySqlThreadId } from 'unreq';

const pool = mysql.createPool({/* config */});
const mysqlCancelHook = createMySqlCancellationHook(pool);

// Associate the thread ID with a request
const connection = await pool.getConnection();
try {
  const threadId = getMySqlThreadId(connection);
  await registry.associateDbIdentifier(requestId, { threadId });
  // Run your query...
} finally {
  connection.release();
}
```

### MongoDB

```typescript
import { MongoClient } from 'mongodb';
import { createMongoDbCancellationHook, getMongoDbOperationId } from 'unreq';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();
const db = client.db('mydb');

const mongodbCancelHook = createMongoDbCancellationHook(db);

// Associate with the current operation
const operationId = await getMongoDbOperationId(db, { ns: 'mydb.collection' });
if (operationId) {
  await registry.associateDbIdentifier(requestId, { operationId });
}
```

## OpenTelemetry Integration

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-node';
import { createExpressCancellationMiddleware } from 'unreq';

// Set up your tracer provider
const tracerProvider = new NodeTracerProvider();
tracerProvider.register();

// Pass it to the middleware
const { middleware } = createExpressCancellationMiddleware({
  dbCancellationHook: myDbCancelHook,
  otelTracerProvider: tracerProvider
});
```

## Architecture

- **Request ID Middleware**: Extracts or generates a unique ID for each request and sets up cancellation detection
- **Cancellation Registry**: Tracks active requests and their associated database operations
- **Database Cancellation Hook**: A user-provided function that handles the actual database-specific cancellation logic
- **OpenTelemetry Integration**: Creates spans and events for the entire cancellation lifecycle

## License

MIT
