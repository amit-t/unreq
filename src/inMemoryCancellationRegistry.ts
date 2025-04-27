// src/inMemoryCancellationRegistry.ts
import type { CancellationRegistry, DbCancellationHook } from './types';

export class InMemoryCancellationRegistry implements CancellationRegistry {
  private entries = new Map<string, { status: 'active' | 'cancelling' | 'cancelled' | 'finished'; dbIdentifier?: any }>();
  private timers = new Map<string, NodeJS.Timeout>();
  private ttl: number;
  private hook: DbCancellationHook;

  constructor(hook: DbCancellationHook, ttlSeconds = 3600) {
    this.hook = hook;
    this.ttl = ttlSeconds * 1000;
  }

  register(requestId: string): void {
    this.entries.set(requestId, { status: 'active' });
    const timer = setTimeout(() => {
      this.entries.delete(requestId);
      this.timers.delete(requestId);
    }, this.ttl);
    this.timers.set(requestId, timer);
  }

  async markForCancellation(requestId: string): Promise<void> {
    const entry = this.entries.get(requestId);
    if (!entry || entry.status !== 'active') return;
    entry.status = 'cancelling';
    if (entry.dbIdentifier !== undefined) {
      await this.hook(requestId, entry.dbIdentifier);
    }
    entry.status = 'cancelled';
  }

  associateDbIdentifier(requestId: string, dbIdentifier: any): void {
    const entry = this.entries.get(requestId);
    if (!entry) {
      throw new Error(`No entry found for requestId "${requestId}"`);
    }
    entry.dbIdentifier = dbIdentifier;
  }

  markAsFinished(requestId: string): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    entry.status = 'finished';
    const timer = this.timers.get(requestId);
    if (timer) clearTimeout(timer);
    this.entries.delete(requestId);
    this.timers.delete(requestId);
  }

  getStatus(requestId: string): 'active' | 'cancelling' | 'cancelled' | 'finished' {
    const entry = this.entries.get(requestId);
    return entry?.status ?? 'finished';
  }
}
