import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/** nginx corta a los 65 s sin datos (proxy_read_timeout): ping bastante antes. */
export const PRINT_AGENT_HEARTBEAT_MS = 25_000;

/**
 * Aviso en vivo al print agent de un local: "hay trabajos, pedilos ya".
 * No manda el trabajo: el agente sigue reservándolos con GET /print-agent/jobs (claimToken),
 * así un aviso perdido o duplicado no imprime dos veces.
 * Bus propio (no ShopLiveService) para no despertar al front con cada job.
 */
@Injectable()
export class PrintAgentLiveService {
  private readonly shops = new Map<string, Subject<MessageEvent>>();

  stream(shopId: string): Observable<MessageEvent> {
    const id = String(shopId ?? '').trim();
    return new Observable((subscriber) => {
      const push = (ev: MessageEvent) => {
        if (subscriber.closed) return;
        try {
          subscriber.next(ev);
        } catch {
          /* cliente caído / socket cerrado */
        }
      };
      // hello: el agente hace un poll al conectar (cubre lo encolado mientras estaba caído).
      setImmediate(() => push(this.event('hello')));
      const sub = this.ensure(id).subscribe({
        next: (ev) => setImmediate(() => push(ev)),
      });
      const hb = setInterval(() => {
        setImmediate(() => push(this.event('ping')));
      }, PRINT_AGENT_HEARTBEAT_MS);
      return () => {
        clearInterval(hb);
        sub.unsubscribe();
        const bus = this.shops.get(id);
        if (bus && !bus.observed) this.shops.delete(id);
      };
    });
  }

  /** Hay trabajos PENDING nuevos (o reencolados) para el local. */
  notifyJobs(shopId: string): void {
    const id = String(shopId ?? '').trim();
    if (!id) return;
    const bus = this.shops.get(id);
    if (!bus) return;
    const ev = this.event('jobs');
    // Mismo criterio que ShopLiveService: no escribir sockets SSE en el turno del mutador.
    setTimeout(() => {
      setImmediate(() => {
        try {
          bus.next(ev);
        } catch {
          /* ignore */
        }
      });
    }, 0);
  }

  /** Hay al menos un agente conectado al stream del local. */
  isConnected(shopId: string): boolean {
    return !!this.shops.get(String(shopId ?? '').trim())?.observed;
  }

  private event(type: 'hello' | 'ping' | 'jobs'): MessageEvent {
    return { type, data: { type, at: Date.now() } } as MessageEvent;
  }

  private ensure(shopId: string): Subject<MessageEvent> {
    let bus = this.shops.get(shopId);
    if (!bus) {
      bus = new Subject<MessageEvent>();
      this.shops.set(shopId, bus);
    }
    return bus;
  }
}
