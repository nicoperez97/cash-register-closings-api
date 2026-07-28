# Cash Register Closings API

NestJS + TypeORM + MySQL + JWT para cierres de caja multi-local.

## Setup rápido

```bash
cp .env.example .env
# creá la DB: cash_register_closings
npm install
npm run start:dev
```

Con `DB_SYNC=true` la API crea tablas y siembra:
- Locales: **Al Panino**, **Tutto Passa**
- Users (password `demo`):
  - `admin@cierres.com` (ADMIN, ambos locales)
  - `manager@cierres.com` (MANAGER, ambos)
  - `cashier@cierres.com` (CASHIER, solo Al Panino)
- Cierres de muestra tomados de los chats WhatsApp

Swagger: http://localhost:3000/api/docs

## Scripts SQL (opcionales)

Orden en `database/`:

1. `001_schema.sql`
2. `002_seed_roles_permissions.sql`
3. `003_seed_shops_users.sql` (preferí el seed runtime de la API para el hash bcrypt)
4. `004_seed_sample_closings.sql`

## Endpoints clave

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/shops/mine`
- `GET|POST /api/v1/shops/:shopId/closings`
- `GET /api/v1/shops/:shopId/reports/summary?from&to`
- `GET /api/v1/shops/:shopId/reports/export.xlsx?from&to`
