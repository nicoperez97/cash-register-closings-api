import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

const BASE_URL = 'https://api.deliverate.io';

export type DeliverateAuthResponse = {
  user_code?: number;
  id_token: string;
  shops?: unknown[];
  username?: string;
  is_integration?: boolean;
  created_date?: string;
};

export type DeliverateCreateShopResponse = {
  created_date?: string;
  deli_id: string;
  integration_id: string;
};

export type DeliverateCreateOrderPayload = {
  integration_id: string;
  integration_order_number: string;
  cash_price: number;
  price: number;
  street_number: string;
  is_exclusive_order?: boolean;
  location: { coordinates: [number, number]; type: 'Point' };
  notes?: string;
  telephone: string;
  is_test_order?: boolean;
};

export type DeliverateOrder = {
  order_id: string;
  integration_id?: string;
  integration_order_number?: string;
  state?: number;
  is_kitchen_ready?: boolean | null;
  dboy_id?: number | null;
  distance_price?: number;
  withdrawn_delay?: number;
  confirmed_delay?: number;
  is_high_demand?: boolean;
  [key: string]: unknown;
};

export type DeliverateDboyLocation = {
  dboy_id: number;
  location: { type: 'Point'; coordinates: [number, number] };
  accuracy?: number;
  speed?: number;
  bearing?: number;
  created_date?: string;
  shift?: string;
};

@Injectable()
export class DeliverateClient {
  private readonly logger = new Logger(DeliverateClient.name);

  private async request<T>(
    method: string,
    path: string,
    opts?: { token?: string | null; body?: unknown },
  ): Promise<T> {
    const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts?.token) {
      headers.authorization = opts.token;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      this.logger.warn(`Deliverate network error ${method} ${path}: ${String(err)}`);
      throw new ServiceUnavailableException('No se pudo contactar Deliverate');
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (!res.ok) {
      const msg =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : `Deliverate HTTP ${res.status}`;
      this.logger.warn(`Deliverate ${method} ${path} → ${res.status}: ${msg}`);
      throw new BadRequestException(msg || 'Error en Deliverate');
    }

    return data as T;
  }

  authenticate(username: string, password: string) {
    return this.request<DeliverateAuthResponse>('POST', '/user/authenticate', {
      body: { username, password },
    });
  }

  upsertApiKey(token: string, url: string, description: string) {
    return this.request<DeliverateAuthResponse>('POST', '/integrations/upsertApiKey', {
      token,
      body: { url, description },
    });
  }

  createIntegrationShop(token: string, payload: Record<string, unknown>) {
    return this.request<DeliverateCreateShopResponse>(
      'POST',
      '/user/createIntegrationShop',
      { token, body: payload },
    );
  }

  createOrder(token: string, payload: DeliverateCreateOrderPayload) {
    return this.request<DeliverateOrder>('POST', '/order/createOrder', {
      token,
      body: payload,
    });
  }

  updateOrderState(
    token: string,
    payload: { order_id: string; is_kitchen_ready?: boolean; state?: number },
  ) {
    return this.request<DeliverateOrder>('PUT', '/order/updateOrderStateById', {
      token,
      body: payload,
    });
  }

  getDboyLocation(token: string, dboyId: number) {
    return this.request<DeliverateDboyLocation>(
      'GET',
      `/dboy/getDboyLocation/${dboyId}`,
      { token },
    );
  }
}
