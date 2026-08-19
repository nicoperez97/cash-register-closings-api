import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type ShopLiveDomain = 'reservations' | 'waiting' | 'attendance';

@Injectable()
export class ShopLiveService {
  private readonly shops = new Map<string, Subject<MessageEvent>>();

  stream(shopId: string): Observable<MessageEvent> {
    const bus = this.ensure(shopId);
    return new Observable((subscriber) => {
      subscriber.next(this.event('hello'));
      const sub = bus.subscribe(subscriber);
      const hb = setInterval(() => {
        subscriber.next(this.event('hello'));
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
    try {
      this.ensure(id).next(this.event(domain));
    } catch {
      /* ignore */
    }
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
