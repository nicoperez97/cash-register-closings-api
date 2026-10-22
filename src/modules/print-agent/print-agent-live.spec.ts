import { ExecutionContext, HttpException, MessageEvent, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { PublicAbuseGuard } from '../../common/public-abuse.guard';
import { PRINT_AGENT_HEARTBEAT_MS, PrintAgentLiveService } from './print-agent-live.service';
import { PrintAgentController } from './print-agent.controller';
import { PrintAgentService } from './print-agent.service';

const flush = () => new Promise((r) => setTimeout(r, 5));
/** Los avisos van diferidos (setTimeout + setImmediate): esperar a que lleguen. */
async function waitFor(types: string[], n: number) {
  for (let i = 0; i < 200 && types.length < n; i += 1) await flush();
}

function collect(stream: Observable<MessageEvent>) {
  const types: string[] = [];
  const sub = stream.subscribe((ev) => types.push(String(ev.type)));
  return { types, sub };
}

describe('PrintAgentLiveService', () => {
  afterEach(() => jest.useRealTimers());

  it('saluda al conectar y avisa solo al local del job', async () => {
    const live = new PrintAgentLiveService();
    const a = collect(live.stream('shop-a'));
    const b = collect(live.stream('shop-b'));
    await waitFor(a.types, 1);
    await waitFor(b.types, 1);
    live.notifyJobs('shop-a');
    await waitFor(a.types, 2);
    await flush();
    expect(a.types).toEqual(['hello', 'jobs']);
    expect(b.types).toEqual(['hello']);
    a.sub.unsubscribe();
    b.sub.unsubscribe();
  });

  it('manda ping antes del timeout de nginx (65 s)', () => {
    jest.useFakeTimers();
    const live = new PrintAgentLiveService();
    const a = collect(live.stream('shop-a'));
    jest.advanceTimersByTime(PRINT_AGENT_HEARTBEAT_MS * 2 + 10);
    expect(PRINT_AGENT_HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
    expect(a.types).toEqual(['hello', 'ping', 'ping']);
    a.sub.unsubscribe();
  });

  it('libera el bus al desconectar y no falla sin oyentes', async () => {
    const live = new PrintAgentLiveService();
    const a = collect(live.stream('shop-a'));
    expect(live.isConnected('shop-a')).toBe(true);
    a.sub.unsubscribe();
    expect(live.isConnected('shop-a')).toBe(false);
    expect(() => live.notifyJobs('shop-a')).not.toThrow();
    expect(() => live.notifyJobs('')).not.toThrow();
    await flush();
    expect(a.types).toEqual([]);
  });
});

describe('PrintAgentController.events', () => {
  it('rechaza token inválido antes de abrir el stream', async () => {
    const service = {
      resolveShopFromToken: jest.fn().mockRejectedValue(new UnauthorizedException()),
    } as unknown as PrintAgentService;
    const live = new PrintAgentLiveService();
    const stream = jest.spyOn(live, 'stream');
    const ctrl = new PrintAgentController(service, live);
    await expect(ctrl.events('Bearer pa_malo')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stream).not.toHaveBeenCalled();
  });

  it('abre el stream del local del token', async () => {
    const service = {
      resolveShopFromToken: jest.fn().mockResolvedValue({ id: 'shop-a' }),
    } as unknown as PrintAgentService;
    const live = new PrintAgentLiveService();
    const ctrl = new PrintAgentController(service, live);
    const a = collect(await ctrl.events('Bearer pa_bueno'));
    await waitFor(a.types, 1);
    live.notifyJobs('shop-a');
    await waitFor(a.types, 2);
    expect(service.resolveShopFromToken).toHaveBeenCalledWith('Bearer pa_bueno');
    expect(a.types).toEqual(['hello', 'jobs']);
    a.sub.unsubscribe();
  });
});

describe('PrintAgentService avisa al agente', () => {
  function build(job?: Record<string, unknown>) {
    const jobs = {
      findOne: jest.fn().mockResolvedValue(job ?? null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'job-1', ...v })),
    };
    const shopLive = { tick: jest.fn() };
    const agentLive = { notifyJobs: jest.fn() };
    const service = new PrintAgentService(
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      shopLive as never,
      agentLive as never,
    );
    return { service, agentLive };
  }
  const shop = { id: 'shop-a', name: 'Local' } as never;

  it('al encolar un trabajo', async () => {
    const { service, agentLive } = build();
    await service.enqueueTest(shop);
    expect(agentLive.notifyJobs).toHaveBeenCalledWith('shop-a');
  });

  it('al reencolar un fallo para reintento', async () => {
    const { service, agentLive } = build({ id: 'job-1', status: 'CLAIMED', attempts: 0, payload: {} });
    const res = await service.ackJob(shop, 'job-1', { status: 'FAILED', error: 'sin papel' });
    expect(res.status).toBe('PENDING');
    expect(agentLive.notifyJobs).toHaveBeenCalledWith('shop-a');
  });

  it('no avisa cuando el trabajo quedó impreso', async () => {
    const { service, agentLive } = build({ id: 'job-1', status: 'CLAIMED', attempts: 0, payload: {} });
    await service.ackJob(shop, 'job-1', { status: 'PRINTED' });
    expect(agentLive.notifyJobs).not.toHaveBeenCalled();
  });
});

describe('PublicAbuseGuard con /print-agent/events', () => {
  it('cuenta en el bucket del agente (120/min), no en el genérico de 40', () => {
    const guard = new PublicAbuseGuard(
      { getAllAndOverride: () => true } as unknown as Reflector,
      { get: () => undefined } as unknown as ConfigService,
    );
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/api/v1/print-agent/events',
          headers: {},
          ip: '10.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
    for (let i = 0; i < 120; i += 1) expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });
});
