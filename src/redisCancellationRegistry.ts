// src/redisCancellationRegistry.ts
import type { CancellationRegistry, DbCancellationHook } from './types';

export class RedisCancellationRegistry implements CancellationRegistry {
  private redisClient: any;
  private keyPrefix = 'unreq:';
  private ttl: number;
  private hook: DbCancellationHook;

  constructor(hook: DbCancellationHook, redisOptions: any, ttlSeconds = 3600) {
    this.hook = hook;
    this.ttl = ttlSeconds;
    
    // If redisOptions is a client instance, use it directly
    if (redisOptions && typeof redisOptions === 'object' && typeof redisOptions.set === 'function') {
      this.redisClient = redisOptions;
    } else {
      throw new Error('Redis client must be provided');
    }
  }

  private getKey(requestId: string): string {
    return `${this.keyPrefix}${requestId}`;
  }

  async register(requestId: string): Promise<void> {
    const key = this.getKey(requestId);
    const entry = JSON.stringify({ status: 'active' });
    await this.redisClient.set(key, entry, 'EX', this.ttl);
  }

  async markForCancellation(requestId: string): Promise<void> {
    const key = this.getKey(requestId);
    const entryJson = await this.redisClient.get(key);
    
    if (!entryJson) return;
    
    const entry = JSON.parse(entryJson);
    if (entry.status !== 'active') return;
    
    // Update to cancelling status
    entry.status = 'cancelling';
    await this.redisClient.set(key, JSON.stringify(entry), 'EX', this.ttl);
    
    // If we have a dbIdentifier, trigger the hook
    if (entry.dbIdentifier !== undefined) {
      await this.hook(requestId, entry.dbIdentifier);
    }
    
    // Update to cancelled status
    entry.status = 'cancelled';
    await this.redisClient.set(key, JSON.stringify(entry), 'EX', this.ttl);
  }

  async associateDbIdentifier(requestId: string, dbIdentifier: any): Promise<void> {
    const key = this.getKey(requestId);
    const entryJson = await this.redisClient.get(key);
    
    if (!entryJson) {
      throw new Error(`No entry found for requestId "${requestId}"`);
    }
    
    const entry = JSON.parse(entryJson);
    entry.dbIdentifier = dbIdentifier;
    await this.redisClient.set(key, JSON.stringify(entry), 'EX', this.ttl);
  }

  async markAsFinished(requestId: string): Promise<void> {
    const key = this.getKey(requestId);
    await this.redisClient.del(key);
  }

  async getStatus(requestId: string): Promise<'active' | 'cancelling' | 'cancelled' | 'finished'> {
    const key = this.getKey(requestId);
    const entryJson = await this.redisClient.get(key);
    
    if (!entryJson) return 'finished';
    
    const entry = JSON.parse(entryJson);
    return entry.status;
  }
}
