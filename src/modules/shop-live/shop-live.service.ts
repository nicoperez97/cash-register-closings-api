import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type ShopLiveDomain = 'reservations' | 'waiting' | 'attendance' | 'inbox';

/**
 * Bus SSE por local.
 * Importante: nunca escribir en sockets SSE en el mismo turno que un POST/PATCH.
 * Un cliente lento (backpressure) bloqueaba el event loop y el alta quedaba en pending.
 */
@Injectable()
export class ShopLiveService {
  private readonly shops = new Map<string, Subject<MessageEvent>>();

  stream(shopId: string): Observable<MessageEvent> {
    const bus = this.ensure(shopId);
    return new Observable((subscriber) => {
      const push = (ev: MessageEvent) => {
        if (subscriber.closed) return;
        try {
          subscriber.next(ev);
        } catch {
          /* cliente caído / socket cerrado */
        }
      };
      // Hola inicial también diferido: no competir con el request que abrió el stream.
      setImmediate(() => push(this.event('hello')));
      const sub = bus.subscribe({
        next: (ev) => {
          // Un setImmediate por suscriptor: Subject.next no escribe sockets en sync.
          setImmediate(() => push(ev));
        },
        error: (err) => {
          try {
            subscriber.error(err);
          } catch {
            /* ignore */
          }
        },
        complete: () => {
          try {
            subscriber.complete();
          } catch {
            /* ignore */
          }
        },
      });
      const hb = setInterval(() => {
        setImmediate(() => push(this.event('hello')));
      }, 25_000);
      return () => {
        clearInterval(hb);
        sub.unsubscribe();
      };
    });
  }

  tick(shopId: string, domain: ShopLiveDomain): void {
    const id = String(shopId ?? '').trim();
    if (!id) return;
    const ev = this.event(domain);
    // Doble defer: deja flush del HTTP response del mutador antes de tocar SSE.
    setTimeout(() => {
      setImmediate(() => {
        try {
          this.ensure(id).next(ev);
        } catch {
          /* ignore */
        }
      });
    }, 0);
  }

  private event(domain: ShopLiveDomain | 'hello'): MessageEvent {
    return { data: { domain, at: Date.now() } } as MessageEvent;
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
