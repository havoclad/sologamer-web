/**
 * Typed event system — generic across all games.
 * Games extend BaseEvent with their own event types.
 */

export interface BaseEvent {
  type: string;
  timestamp?: number;
}

export type EventHandler<E extends BaseEvent> = (event: E) => void;

export class EventBus<E extends BaseEvent = BaseEvent> {
  private handlers = new Map<string, Set<EventHandler<E>>>();
  private globalHandlers = new Set<EventHandler<E>>();
  private log: E[] = [];
  private recording = true;

  /** Subscribe to a specific event type */
  on(type: string, handler: EventHandler<E>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /** Subscribe to all events */
  onAny(handler: EventHandler<E>): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  /** Emit an event */
  emit(event: E): void {
    if (this.recording) {
      this.log.push({ ...event, timestamp: event.timestamp ?? Date.now() });
    }
    const handlers = this.handlers.get(event.type);
    if (handlers) for (const h of handlers) h(event);
    for (const h of this.globalHandlers) h(event);
  }

  /** Get the event log */
  getLog(): readonly E[] {
    return this.log;
  }

  /** Clear the event log */
  clearLog(): void {
    this.log = [];
  }

  /** Toggle recording */
  setRecording(on: boolean): void {
    this.recording = on;
  }

  /** Remove all handlers */
  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}
