import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCancellationRegistry, createAutoCancellationMiddleware } from '../index';
import { InMemoryCancellationRegistry } from '../inMemoryCancellationRegistry';
import { RedisCancellationRegistry } from '../redisCancellationRegistry';
import type { Request, Response } from 'express';
import type { LibraryConfig } from '../types';

// Mock dependencies
vi.mock('../inMemoryCancellationRegistry', () => ({
  InMemoryCancellationRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    markForCancellation: vi.fn(),
    markAsFinished: vi.fn(),
    associateDbIdentifier: vi.fn(),
    getStatus: vi.fn().mockReturnValue('active')
  }))
}));

vi.mock('../redisCancellationRegistry', () => ({
  RedisCancellationRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    markForCancellation: vi.fn(),
    markAsFinished: vi.fn(),
    associateDbIdentifier: vi.fn(),
    getStatus: vi.fn().mockReturnValue('active')
  }))
}));

vi.mock('../otel', () => ({
  OTelIntegration: vi.fn().mockImplementation(() => ({
    createRequestSpan: vi.fn(),
    markRequestCancelled: vi.fn(),
    endRequestSpan: vi.fn()
  }))
}));

describe('createCancellationRegistry', () => {
  const mockDbCancellationHook = vi.fn().mockResolvedValue(true);
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create an in-memory registry by default', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook
    };
    
    const registry = createCancellationRegistry(config);
    
    expect(InMemoryCancellationRegistry).toHaveBeenCalledWith(mockDbCancellationHook, undefined);
    expect(registry).toBeDefined();
  });

  it('should create a redis registry when specified', () => {
    const mockRedisClient = { get: vi.fn(), set: vi.fn() };
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook,
      registry: {
        type: 'redis',
        redisClient: mockRedisClient,
        ttlSeconds: 60
      }
    };
    
    const registry = createCancellationRegistry(config);
    
    expect(RedisCancellationRegistry).toHaveBeenCalledWith(
      mockDbCancellationHook, 
      mockRedisClient, 
      60
    );
    expect(registry).toBeDefined();
  });

  it('should throw an error when redis type is specified without a client', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook,
      registry: {
        type: 'redis'
      }
    };
    
    expect(() => createCancellationRegistry(config)).toThrow(
      'Redis client must be provided when using redis registry type'
    );
  });
});

describe('createAutoCancellationMiddleware', () => {
  const mockDbCancellationHook = vi.fn().mockResolvedValue(true);
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  const mockNext = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRequest = {
      headers: {},
      on: vi.fn(),
      method: 'GET',
      url: '/test'
    };
    
    mockResponse = {
      setHeader: vi.fn(),
      on: vi.fn(),
      statusCode: 200
    };
  });

  it('should create middleware and registry', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook
    };
    
    const { cancellationMiddleware, cancellationRegistry } = createAutoCancellationMiddleware(config);
    
    expect(cancellationMiddleware).toBeTypeOf('function');
    expect(cancellationRegistry).toBeDefined();
  });

  it('should process a request with middleware', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook,
      requestIdHeader: 'x-custom-id'
    };
    
    const { cancellationMiddleware } = createAutoCancellationMiddleware(config);
    
    // Setup request event handlers
    let requestCloseHandler: Function = () => {};
    let responseFinishHandler: Function = () => {};
    
    (mockRequest.on as any).mockImplementation((event: string, handler: Function) => {
      if (event === 'close') requestCloseHandler = handler;
      return mockRequest;
    });
    
    (mockResponse.on as any).mockImplementation((event: string, handler: Function) => {
      if (event === 'finish') responseFinishHandler = handler;
      return mockResponse;
    });
    
    // Execute middleware
    cancellationMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Verify request ID is set and header is returned
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-custom-id', expect.any(String));
    expect(mockNext).toHaveBeenCalled();
    
    // Execute close handler to simulate request cancellation
    requestCloseHandler();
    
    // Execute finish handler to simulate request completion
    responseFinishHandler();
  });

  it('should use provided request ID from header', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook,
      requestIdHeader: 'x-custom-id'
    };
    
    const customRequestId = 'custom-request-id';
    mockRequest.headers = { 'x-custom-id': customRequestId };
    
    const { cancellationMiddleware } = createAutoCancellationMiddleware(config);
    
    cancellationMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    
    expect(mockResponse.setHeader).toHaveBeenCalledWith('x-custom-id', customRequestId);
  });

  it('should integrate with OTel when provider is specified', () => {
    const config: LibraryConfig = {
      dbCancellationHook: mockDbCancellationHook,
      otelTracerProvider: {}
    };
    
    const { cancellationMiddleware } = createAutoCancellationMiddleware(config);
    
    // Setup event handlers
    let requestCloseHandler: Function = () => {};
    let responseFinishHandler: Function = () => {};
    
    (mockRequest.on as any).mockImplementation((event: string, handler: Function) => {
      if (event === 'close') requestCloseHandler = handler;
      return mockRequest;
    });
    
    (mockResponse.on as any).mockImplementation((event: string, handler: Function) => {
      if (event === 'finish') responseFinishHandler = handler;
      return mockResponse;
    });
    
    cancellationMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
    
    // Simulate request close
    requestCloseHandler();
    
    // Simulate response finish
    responseFinishHandler();
  });
});
