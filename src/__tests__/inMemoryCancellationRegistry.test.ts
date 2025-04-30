import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryCancellationRegistry } from '../inMemoryCancellationRegistry';

describe('InMemoryCancellationRegistry', () => {
  let registry: InMemoryCancellationRegistry;
  const mockDbCancellationHook = vi.fn().mockResolvedValue(true);
  
  beforeEach(() => {
    vi.clearAllMocks();
    registry = new InMemoryCancellationRegistry(mockDbCancellationHook);
  });

  it('should register a request ID', () => {
    const requestId = 'test-request-id';
    registry.register(requestId);
    
    expect(registry.getStatus(requestId)).toBe('active');
  });

  it('should mark a request for cancellation', async () => {
    const requestId = 'test-request-id';
    registry.register(requestId);
    await registry.markForCancellation(requestId);
    
    expect(registry.getStatus(requestId)).toBe('cancelled');
  });

  it('should mark a request as finished', () => {
    const requestId = 'test-request-id';
    registry.register(requestId);
    registry.markAsFinished(requestId);
    
    expect(registry.getStatus(requestId)).toBe('finished');
  });

  it('should associate a database identifier with a request', async () => {
    const requestId = 'test-request-id';
    const dbIdentifier = 'test-db-identifier';
    
    registry.register(requestId);
    registry.associateDbIdentifier(requestId, dbIdentifier);
    registry.markForCancellation(requestId);
    
    // Verify that the hook was called
    expect(mockDbCancellationHook).toHaveBeenCalledWith(requestId, dbIdentifier);
  });

  it('should handle non-existent request IDs', () => {
    const requestId = 'non-existent-id';
    
    expect(registry.getStatus(requestId)).toBe('finished');
    registry.markForCancellation(requestId); // This should not throw
    registry.markAsFinished(requestId); // This should not throw
  });

  it('should respect TTL when provided', async () => {
    // Create registry with a short TTL
    const ttlSeconds = 0.01; // 10ms
    const registryWithTtl = new InMemoryCancellationRegistry(mockDbCancellationHook, ttlSeconds);
    
    const requestId = 'test-ttl-id';
    registryWithTtl.register(requestId);
    
    expect(registryWithTtl.getStatus(requestId)).toBe('active');
    
    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 20));
    
    // Request should be considered finished after TTL
    expect(registryWithTtl.getStatus(requestId)).toBe('finished');
  });
});
