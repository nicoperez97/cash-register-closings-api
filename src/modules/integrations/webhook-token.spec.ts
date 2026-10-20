import { UnauthorizedException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/** Webhook Deliverate: el token se valida contra el secreto del local del pedido. */
function build(secretByShop: Record<string, string | null>) {
  const order = { id: 'o1', shopId: 'shop-a', status: 'PREPARING', externalMeta: {} };
  const orders = {
    findOne: jest.fn(async () => ({ ...order })),
    save: jest.fn(async (o: unknown) => o),
  };
  const integrations = {
    findOne: jest.fn(async ({ where }: { where: { shopId: string } }) => ({
      id: `int-${where.shopId}`,
      shopId: where.shopId,
    })),
    createQueryBuilder: jest.fn(() => {
      let id = '';
      const qb = {
        addSelect: () => qb,
        where: (_: string, p: { id: string }) => {
          id = p.id;
          return qb;
        },
        getOne: async () => ({ webhookSecret: secretByShop[id.replace('int-', '')] ?? null }),
      };
      return qb;
    }),
  };
  const live = { tick: jest.fn() };
  const service = new IntegrationsService(
    integrations as never,
    orders as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    live as never,
  );
  return { service, orders };
}

const update = { order_id: 'deli-1', state: 99 };

describe('IntegrationsService webhook token por local', () => {
  it('rechaza un token que no es el del local del pedido', async () => {
    const { service, orders } = build({ 'shop-a': 'secreto-a' });
    await expect(
      service.handleWebhook({ action: 'order_update', update, token: 'secreto-b' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(orders.save).not.toHaveBeenCalled();
  });

  it('rechaza si falta el token y el local tiene secreto', async () => {
    const { service } = build({ 'shop-a': 'secreto-a' });
    await expect(
      service.handleWebhook({ action: 'order_update', update }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('acepta el token del local', async () => {
    const { service } = build({ 'shop-a': 'secreto-a' });
    await expect(
      service.handleWebhook({ action: 'order_update', update, token: 'secreto-a' }),
    ).resolves.toEqual({ ok: true });
  });

  it('local registrado antes del secreto: se acepta hasta reconectar', async () => {
    const { service } = build({ 'shop-a': null });
    await expect(
      service.handleWebhook({ action: 'order_update', update }),
    ).resolves.toEqual({ ok: true });
  });
});
