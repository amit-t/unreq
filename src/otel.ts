// src/otel.ts
import { Span, SpanStatusCode, Tracer, trace } from '@opentelemetry/api';

export interface SpanContext {
  span: Span;
  tracer: Tracer;
}

export class OTelIntegration {
  private tracer: Tracer;
  private spansByRequestId = new Map<string, Span>();

  constructor(tracerName = 'unreq') {
    this.tracer = trace.getTracer(tracerName);
  }

  createRequestSpan(requestId: string, method: string, url: string): SpanContext {
    const span = this.tracer.startSpan(`HTTP ${method}`, {
      attributes: {
        'http.method': method,
        'http.url': url,
        'request.id': requestId,
      },
    });
    
    this.spansByRequestId.set(requestId, span);
    
    return {
      span,
      tracer: this.tracer,
    };
  }

  markRequestCancelled(requestId: string): void {
    const span = this.spansByRequestId.get(requestId);
    if (!span) return;
    
    span.addEvent('request.cancelled', {
      'request.id': requestId,
      'cancelled.timestamp': Date.now(),
    });
  }

  markDbOperationAssociated(requestId: string, dbIdentifier: any): void {
    const span = this.spansByRequestId.get(requestId);
    if (!span) return;
    
    span.addEvent('db.operation.associated', {
      'request.id': requestId,
      'db.identifier': JSON.stringify(dbIdentifier),
    });
  }

  markDbOperationCancelled(requestId: string, dbIdentifier: any, success: boolean): void {
    const span = this.spansByRequestId.get(requestId);
    if (!span) return;
    
    span.addEvent('db.operation.cancellation.attempt', {
      'request.id': requestId,
      'db.identifier': JSON.stringify(dbIdentifier),
      'cancellation.success': success,
    });
  }

  endRequestSpan(requestId: string, statusCode?: number, error?: Error): void {
    const span = this.spansByRequestId.get(requestId);
    if (!span) return;
    
    if (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
    } else if (statusCode && statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP status code ${statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    
    span.end();
    this.spansByRequestId.delete(requestId);
  }
}
