from opentelemetry import trace, context # Keep these so they are re-exported.
from opentelemetry.sdk.trace import Resource, TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor, SpanExporter, SpanExportResult,
)
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .dummy import DUMMY_TRACER_PROVIDER

def serialise_span_ctx(span=None):
    """Serialise the provided span into a form suitable for sending over the RPC connnection. If no span is provided,
       get the current span from the context."""

    span = span or trace.get_current_span()
    if span:
        # Would like to use TraceContextTextMapPropagator here, but it only works with Spans, not ReadableSpans (?!)
        span_context = span.get_span_context()
        return {
            "traceparent": f"00-{trace.format_trace_id(span_context.trace_id)}-{trace.format_span_id(span_context.span_id)}-{span_context.trace_flags:02x}",
            **({"tracestate": span_context.trace_state.to_header()} if span_context.trace_state else {})
        }
    else:
        return None

def deserialise_parent_ctx(sts):
    return TraceContextTextMapPropagator().extract(carrier=sts) if sts else None

_exporters = []


class AnvilRpcExporter(SpanExporter):

    def __init__(self, is_ready_fn, send_fn):
        _exporters.append(self)
        self.queue = []
        self.is_ready_fn = is_ready_fn
        self.send_fn = send_fn

    def _serialise_span(self, s: ReadableSpan):
        status = {
            "status_code": str(s.status.status_code.name),
        }
        if s.status.description:
            status["description"] = s.status.description

        return {
            "name": s.name,
            "context": serialise_span_ctx(s),
            "kind": s.kind.name,
            "parent_id": trace.format_span_id(s.parent.span_id) if s.parent else None,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "status": status,
            "attributes": dict(s.attributes),
            "events": [{"name": e.name, "attributes": dict(e.attributes), "timestamp": e.timestamp} for e in s.events],
            "links": s.links, # TODO: Test links
            "resource": {
                "attributes": dict(s.resource.attributes),
                "schema_url": s.resource.schema_url
            },
            "instrumentation_info": {
                "name": s.instrumentation_info.name,
                "version": s.instrumentation_info.version,
                "schema_url": s.instrumentation_info.schema_url,
            },
        }

    def _send(self, spans):
        if self.is_ready_fn():
            self.send_fn({
                "type": "SPANS",
                "data": [self._serialise_span(s) for s in spans],
            })
            return True
        else:
            return False


    def export(self, spans):
        if not self._send(spans):
            self.queue.extend(spans)
        return SpanExportResult.SUCCESS

    @classmethod
    def flush_all(cls):
        for s in _exporters:
            if s._send(s.queue):
                s.queue = []

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True

def get_tracer_provider(service_name, exporter):
    tracer_provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    return tracer_provider

_anvil_tracer_provider = DUMMY_TRACER_PROVIDER

def set_internal_tracer_provider(provider):
    global _anvil_tracer_provider
    _anvil_tracer_provider = provider

def get_anvil_tracer_provider():
    return _anvil_tracer_provider
