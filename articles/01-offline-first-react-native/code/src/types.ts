export type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** What the app hands to the queue when the user taps "Save". */
export interface NewRequest {
  method: HttpMethod;
  path: string;
  body: unknown;
}

/** A request after check-in: tagged, persisted, and scheduled. */
export interface QueuedRequest extends NewRequest {
  /** The luggage tag. Sent as the idempotency key, so the server can spot copies. */
  id: string;
  createdAt: number;
  /** Total send attempts. Drives the backoff exponent. */
  attempts: number;
  /** Times the server explicitly asked us to retry. Drives dead-lettering. */
  serverRetries: number;
  /** Persisted wall-clock time, so backoff survives the app being suspended or killed. */
  nextAttemptAt: number;
  lastError?: string;
}

/** The server's verdict on one item in a batch. */
export type ItemResult =
  | { id: string; status: 'delivered' }
  | { id: string; status: 'retry'; reason: string }
  | { id: string; status: 'rejected'; reason: string };

/** Sends one batch. Throws a TransportError when the network, not the server, failed. */
export type Transport = (batch: readonly QueuedRequest[]) => Promise<ItemResult[]>;

export type Reachability = 'online' | 'offline' | 'captive-portal';

export type TransportFailure =
  | 'offline'
  | 'timeout'
  | 'captive-portal'
  | 'server-unavailable'
  | 'bad-response';

export class TransportError extends Error {
  constructor(
    readonly kind: TransportFailure,
    message: string,
    /** From a Retry-After header, when the server sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}
