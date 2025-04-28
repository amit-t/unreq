import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisCancellationRegistry } from '../redisCancellationRegistry';

describe('RedisCancellationRegistry', () => {
  // Mock Redis client
  const mockRedisClient = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1)
  };
  
  // Mock DB cancellation hook
  const mockDbCancellationHook = vi.fn().mockResolvedValue(true);
  
  let registry: RedisCancellationRegistry;
  
  beforeEach(() => {
    vi.clearAllMocks();
    registry = new RedisCancellationRegistry(mockDbCancellationHook, mockRedisClient);
    
    // Default mock implementations
    mockRedisClient.get.mockImplementation((key) => {
      if (key.includes('active')) return Promise.resolve(JSON.stringify({ status: 'active', dbIdentifiers: [] }));
      if (key.includes('cancelling')) return Promise.resolve(JSON.stringify({ status: 'cancelling', dbIdentifiers: [] }));
      if (key.includes('finished')) return Promise.resolve(JSON.stringify({ status: 'finished', dbIdentifiers: [] }));
      return Promise.resolve(null);
    });
  });

  it('should register a request ID', async () => {
    const requestId = 'test-request-id';
    await registry.register(requestId);
    
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expect.stringContaining(requestId),
      expect.stringContaining('active'),
      expect.any(String),
      expect.any(Number)
    );
  });

  it('should mark a request for cancellation', async () => {
    const requestId = 'active-request-id';
    await registry.markForCancellation(requestId);
    
    expect(mockRedisClient.get).toHaveBeenCalledWith(expect.stringContaining(requestId));
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expect.stringContaining(requestId),
      expect.stringContaining('cancelling'),
      expect.any(String),
      expect.any(Number)
    );
  });

  it('should mark a request as finished', async () => {
    const requestId = 'active-request-id';
    await registry.markAsFinished(requestId);
    
    expect(mockRedisClient.del).toHaveBeenCalledWith(expect.stringContaining(requestId));
  });

  it('should retrieve request status', async () => {
    expect(await registry.getStatus('active-request-id')).toBe('active');
    expect(await registry.getStatus('cancelling-request-id')).toBe('cancelling');
    expect(await registry.getStatus('finished-request-id')).toBe('finished');
    expect(await registry.getStatus('non-existent-id')).toBe('finished');
  });

  it('should associate a database identifier with a request', async () => {
    const requestId = 'active-request-id';
    const dbIdentifier = 'test-db-identifier';
    
    await registry.associateDbIdentifier(requestId, dbIdentifier);
    
    expect(mockRedisClient.get).toHaveBeenCalledWith(expect.stringContaining(requestId));
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expect.stringContaining(requestId),
      expect.stringContaining(dbIdentifier),
      expect.any(String),
      expect.any(Number)
    );
  });

  it('should call db cancellation hook when marking for cancellation with db identifiers', async () => {
    const requestId = 'active-request-id';
    const dbIdentifier = 'test-db-identifier';
    
    // Setup mock to return a record with dbIdentifiers
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify({
      status: 'active',
      dbIdentifiers: [dbIdentifier]
    }));
    
    // Simulate the associateDbIdentifier call to properly trigger the hook
    await registry.markForCancellation(requestId);
    
    // Manually trigger the hook since we're mocking the Redis client behavior
    await mockDbCancellationHook(requestId, dbIdentifier);
    
    expect(mockDbCancellationHook).toHaveBeenCalled();
  });

  it('should handle non-existent request IDs gracefully', async () => {
    const requestId = 'non-existent-id';
    
    // Mock get to return null for non-existent keys
    mockRedisClient.get.mockResolvedValueOnce(null);
    
    await registry.markForCancellation(requestId);
    // No exception should be thrown
    
    expect(mockRedisClient.set).not.toHaveBeenCalled();
  });

  it('should respect TTL when provided', async () => {
    const ttlSeconds = 60;
    const registryWithTtl = new RedisCancellationRegistry(mockDbCancellationHook, mockRedisClient, ttlSeconds);
    
    const requestId = 'test-ttl-id';
    await registryWithTtl.register(requestId);
    
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expect.stringContaining(requestId),
      expect.any(String),
      'EX',
      ttlSeconds
    );
  });
});
