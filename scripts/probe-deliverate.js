/**
 * Probe Deliverate API against docs flow using local shop_integrations creds.
 * Run: node scripts/probe-deliverate.js
 * Does not print secrets; only status + message + key fields.
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.deliverate.io';

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.authorization = token;
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data };
}

function summarize(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (/token|password/i.test(k) && typeof out[k] === 'string') {
      out[k] = `${out[k].slice(0, 8)}…(len=${out[k].length})`;
    }
  }
  if (Array.isArray(out.shops)) {
    out.shops = out.shops.map((s) => {
      if (typeof s === 'string') return s;
      if (s && typeof s === 'object') {
        return s.username || s.integration_id || s.name || JSON.stringify(s).slice(0, 80);
      }
      return s;
    });
  }
  return out;
}

function step(title, result) {
  const msg =
    result.data && typeof result.data === 'object' && result.data.message
      ? String(result.data.message)
      : '';
  return {
    title,
    status: result.status,
    ok: result.ok,
    message: msg || undefined,
    data: summarize(result.data),
  };
}

async function main() {
  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'cash_register_closings',
  });

  const [rows] = await conn.query(
    `SELECT username, password, apiToken, integrationId, shopPassword, shopZone,
            businessName, cuit, taxType, ivaCondition, gender, birthDate, ownerName,
            textAddress, cellphone, telephone, emails, locationLat, locationLng, testMode, deliId
     FROM shop_integrations
     WHERE provider='deliverate' AND deletedAt IS NULL
     ORDER BY updatedAt DESC LIMIT 1`,
  );
  await conn.end();

  if (!rows.length) {
    console.log(JSON.stringify({ error: 'No hay shop_integrations deliverate' }, null, 2));
    process.exit(1);
  }

  const row = rows[0];
  const report = {
    meta: {
      username: row.username,
      integrationId: row.integrationId,
      hasPassword: !!row.password,
      hasApiToken: !!row.apiToken,
      hasShopPassword: !!row.shopPassword,
      deliId: row.deliId,
      shopZone: row.shopZone,
      testMode: !!row.testMode,
    },
    steps: [],
  };

  // 1) authenticate parent
  const auth1 = await api('POST', '/user/authenticate', {
    body: { username: row.username, password: row.password },
  });
  report.steps.push(step('1. POST /user/authenticate (cuenta integración)', auth1));
  const token1 = auth1.data?.id_token || null;

  // 1b) authenticate shop
  if (row.integrationId && row.shopPassword) {
    const authShop = await api('POST', '/user/authenticate', {
      body: { username: row.integrationId, password: row.shopPassword },
    });
    report.steps.push(step('1b. POST /user/authenticate (usuario shop)', authShop));
  } else {
    report.steps.push({
      title: '1b. POST /user/authenticate (usuario shop)',
      ok: false,
      skipped: true,
      reason: 'Falta integrationId o shopPassword en DB',
    });
  }

  // 2) upsertApiKey with token1
  let token2 = row.apiToken || null;
  if (token1) {
    const upsert = await api('POST', '/integrations/upsertApiKey', {
      token: token1,
      body: {
        url: 'https://cierres.perezcompany.com.ar/api/v1/webhooks/deliverate',
        description: 'CRC probe',
      },
    });
    report.steps.push(step('2. POST /integrations/upsertApiKey (token_paso_1)', upsert));
    if (upsert.data?.id_token) token2 = upsert.data.id_token;
  } else {
    report.steps.push({
      title: '2. POST /integrations/upsertApiKey',
      skipped: true,
      reason: 'Sin token_paso_1',
    });
  }

  // 2b) upsert with Bearer prefix
  if (token1) {
    const upsertB = await api('POST', '/integrations/upsertApiKey', {
      token: `Bearer ${token1}`,
      body: {
        url: 'https://cierres.perezcompany.com.ar/api/v1/webhooks/deliverate',
        description: 'CRC probe bearer',
      },
    });
    report.steps.push(step('2b. POST /integrations/upsertApiKey (Bearer token_paso_1)', upsertB));
  }

  const orderTokenCandidates = [];
  const pushTok = (label, t) => {
    if (t && !orderTokenCandidates.some((x) => x.t === t)) {
      orderTokenCandidates.push({ label, t });
    }
  };
  pushTok('token_paso_2 (upsert/db)', token2);
  pushTok('token_paso_1 (auth parent)', token1);
  if (report.steps.find((s) => s.title.includes('1b') && s.ok)?.data?.id_token) {
    pushTok(
      'token shop',
      report.steps.find((s) => s.title.includes('1b')).data.id_token,
    );
  }

  // 3) createIntegrationShop — expect 409 if exists
  if (token2 && row.integrationId) {
    const emails = (() => {
      try {
        const e = typeof row.emails === 'string' ? JSON.parse(row.emails) : row.emails;
        return Array.isArray(e) && e.length ? e : ['probe@example.com'];
      } catch {
        return ['probe@example.com'];
      }
    })();
    const payload = {
      username: String(row.integrationId).trim(),
      password: row.shopPassword || 'TempPass123!',
      bussiness_name: row.businessName || 'Probe Shop',
      cellphone: String(row.cellphone || row.telephone || '2215555555').replace(/\D/g, ''),
      cuit: Number(String(row.cuit || '20111111112').replace(/\D/g, '')),
      email: emails.slice(0, 5),
      fullname: row.ownerName || 'Probe User',
      text_address: row.textAddress || 'Calle Falsa 123',
      location: {
        coordinates: [Number(row.locationLat) || -34.9217, Number(row.locationLng) || -57.942],
        type: 'Point',
      },
      shop_zone: row.shopZone || 'La Plata',
      tax_type: row.taxType || 'juridica',
      telephone: String(row.telephone || row.cellphone || '2215555555').replace(/\D/g, ''),
      working_days: [{ day: 1, shifts: ['M', 'N'] }],
    };
    if (row.taxType === 'fisica') {
      payload.birth_date = row.birthDate || '01/01/1990';
      payload.iva_condition = row.ivaCondition || 'RM';
      payload.gender = row.gender || 'm';
    }
    const createShop = await api('POST', '/user/createIntegrationShop', {
      token: token2,
      body: payload,
    });
    report.steps.push(step('3. POST /user/createIntegrationShop (token_paso_2)', createShop));
  } else {
    report.steps.push({
      title: '3. POST /user/createIntegrationShop',
      skipped: true,
      reason: 'Sin token_paso_2 o integrationId',
    });
  }

  // 4) createOrder with each token candidate
  const orderPayload = {
    integration_id: row.integrationId,
    integration_order_number: `probe${Date.now().toString(36).slice(-6)}`,
    cash_price: 0,
    price: 1000,
    street_number: '123',
    is_exclusive_order: false,
    location: {
      coordinates: [-34.9217033, -57.9420769],
      type: 'Point',
    },
    notes: 'CRC probe is_test_order',
    telephone: '2215562414',
    is_test_order: true,
  };

  let createdOrderId = null;
  let workingToken = null;
  let workingLabel = null;

  for (const { label, t } of orderTokenCandidates) {
    const r = await api('POST', '/order/createOrder', { token: t, body: orderPayload });
    report.steps.push(step(`4. POST /order/createOrder (${label})`, r));
    if (r.ok && r.data?.order_id) {
      createdOrderId = r.data.order_id;
      workingToken = t;
      workingLabel = label;
      break;
    }
    // also try Bearer
    const rB = await api('POST', '/order/createOrder', {
      token: `Bearer ${t}`,
      body: orderPayload,
    });
    report.steps.push(step(`4b. POST /order/createOrder (Bearer + ${label})`, rB));
    if (rB.ok && rB.data?.order_id) {
      createdOrderId = rB.data.order_id;
      workingToken = `Bearer ${t}`;
      workingLabel = `Bearer + ${label}`;
      break;
    }
  }

  // 5) kitchen ready + cancel if we created
  if (createdOrderId && workingToken) {
    const ready = await api('PUT', '/order/updateOrderStateById', {
      token: workingToken,
      body: { order_id: createdOrderId, is_kitchen_ready: true },
    });
    report.steps.push(step(`5. PUT /order/updateOrderStateById kitchen_ready (${workingLabel})`, ready));

    const cancel = await api('PUT', '/order/updateOrderStateById', {
      token: workingToken,
      body: { order_id: createdOrderId, state: 6 },
    });
    report.steps.push(step(`6. PUT /order/updateOrderStateById cancel state=6 (${workingLabel})`, cancel));
  } else {
    report.steps.push({
      title: '5-6. updateOrderStateById',
      skipped: true,
      reason: 'No se pudo crear orden de prueba',
    });
  }

  // 7) dboy location (expected 404 without real dboy)
  if (token2) {
    const loc = await api('GET', '/dboy/getDboyLocation/214', { token: token2 });
    report.steps.push(step('7. GET /dboy/getDboyLocation/214 (token_paso_2)', loc));
  }

  // Verdict
  report.verdict = {
    authParent: report.steps.find((s) => s.title.startsWith('1. '))?.ok || false,
    authShop: report.steps.find((s) => s.title.startsWith('1b'))?.ok || false,
    upsertApiKey: report.steps.some((s) => s.title.includes('upsertApiKey') && s.ok),
    createShop: report.steps.find((s) => s.title.startsWith('3. '))?.status,
    createOrderOk: !!createdOrderId,
    workingTokenLabel: workingLabel,
    shopsFromAuth: report.steps.find((s) => s.title.startsWith('1. '))?.data?.shops || [],
  };

  const outPath = path.join(__dirname, 'probe-deliverate-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
