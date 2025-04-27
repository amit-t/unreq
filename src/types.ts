// src/types.ts

export type DbCancellationHook = (requestId: string, dbIdentifier: any) => Promise<boolean>;

export interface CancellationRegistry {
  register(requestId: string): void;
  markForCancellation(requestId: string): void | Promise<void>;
  associateDbIdentifier(requestId: string, dbIdentifier: any): void;
  markAsFinished(requestId: string): void;
  getStatus(requestId: string): 'active' | 'cancelling' | 'cancelled' | 'finished';
}

export interface LibraryConfig {
  requestIdHeader?: string;
  dbCancellationHook: DbCancellationHook;
  registry?: {
    type?: 'in-memory' | 'redis';
    ttlSeconds?: number;
    redisOptions?: string;
    redisClient?: any;
  };
  otelTracerProvider?: any;
}
