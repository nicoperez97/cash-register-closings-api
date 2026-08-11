import { NotificationType } from '../../common/enums';

export type MailTemplateInput = {
  type: string;
  title: string;
  body: string;
  recipientName?: string | null;
  shopName?: string | null;
  shopLogoUrl?: string | null;
  accentColor?: string | null;
  accentSecondary?: string | null;
  /** URL absoluta al módulo relevante en el front (opcional). */
  actionUrl?: string | null;
  actionLabel?: string | null;
};

type TypeMeta = {
  label: string;
  /** Color de acento del aviso (barra / badge). */
  tone: string;
  /** Fondo suave del badge. */
  toneSoft: string;
  hint: string;
};

const TYPE_META: Record<string, TypeMeta> = {
  [NotificationType.STOCK_BELOW_MINIMUM]: {
    label: 'Stock alimentos',
    tone: '#c62828',
    toneSoft: '#fdecea',
    hint: 'Revisá el inventario de alimentos y reponé el producto cuanto antes.',
  },
  [NotificationType.STOCK_SHARED]: {
    label: 'Stock alimentos',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Te compartieron el stock de alimentos del local. Abrí la app para verlo o reenviarlo.',
  },
  [NotificationType.BEVERAGE_STOCK_BELOW_MINIMUM]: {
    label: 'Stock bebidas',
    tone: '#c62828',
    toneSoft: '#fdecea',
    hint: 'Revisá el inventario de bebidas y reponé el producto cuanto antes.',
  },
  [NotificationType.BEVERAGE_STOCK_SHARED]: {
    label: 'Stock bebidas',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Te compartieron el stock de bebidas del local. Abrí la app para verlo o reenviarlo.',
  },
  [NotificationType.SHORTAGE_CREATED]: {
    label: 'Faltantes',
    tone: '#c62828',
    toneSoft: '#fdecea',
    hint: 'Se cargó un faltante crítico (Nada/Poco). Revisá el módulo Faltantes.',
  },
  [NotificationType.SHORTAGE_LEVEL_LOW]: {
    label: 'Faltantes',
    tone: '#e65100',
    toneSoft: '#fff3e0',
    hint: 'Un faltante bajó a nivel crítico. Revisá el módulo Faltantes.',
  },
  [NotificationType.SHORTAGE_RESOLVED]: {
    label: 'Faltantes',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Un faltante dejó de estar crítico. Abrí Faltantes para confirmar.',
  },
  [NotificationType.PAYMENT_VALIDATE]: {
    label: 'Pagos',
    tone: '#e65100',
    toneSoft: '#fff3e0',
    hint: 'Hay un pago pendiente de validación.',
  },
  [NotificationType.PAYMENT_PAY]: {
    label: 'Pagos',
    tone: '#ef6c00',
    toneSoft: '#fff8e1',
    hint: 'Hay un pago listo para abonar.',
  },
  [NotificationType.PAYMENT_REJECTED]: {
    label: 'Pagos',
    tone: '#c62828',
    toneSoft: '#fdecea',
    hint: 'Un pago fue rechazado.',
  },
  [NotificationType.PAYMENT_PAID]: {
    label: 'Pagos',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Un pago quedó registrado como abonado.',
  },
  [NotificationType.CLOSING_CREATED]: {
    label: 'Cierres',
    tone: '#1565c0',
    toneSoft: '#e3f2fd',
    hint: 'Se cargó un nuevo cierre de caja. Si hay efectivo sin destinatario, revisá A Retirar.',
  },
  [NotificationType.CASH_WITHDRAWAL_PICKED]: {
    label: 'Retiros',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Se registró un retiro de efectivo.',
  },
  [NotificationType.PRODUCTION_HOURS_LOGGED]: {
    label: 'Producción',
    tone: '#00695c',
    toneSoft: '#e0f2f1',
    hint: 'Se actualizaron horas de producción.',
  },
  [NotificationType.RESERVATION_REQUEST]: {
    label: 'Reservas',
    tone: '#6a1b9a',
    toneSoft: '#f3e5f5',
    hint: 'Hay una solicitud de reserva para aceptar o rechazar.',
  },
  RESERVATION_ACCEPTED: {
    label: 'Reserva confirmada',
    tone: '#2e7d32',
    toneSoft: '#e8f5e9',
    hint: 'Tu mesa quedó reservada. Te esperamos.',
  },
  RESERVATION_REJECTED: {
    label: 'Reserva',
    tone: '#c62828',
    toneSoft: '#fdecea',
    hint: 'Esta vez no pudimos confirmar tu reserva.',
  },
};

const FALLBACK_META: TypeMeta = {
  label: 'Aviso',
  tone: '#1d65a0',
  toneSoft: '#e8f1f8',
  hint: 'Tenés una nueva notificación en el sistema.',
};

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Conserva saltos de línea del cuerpo en el HTML del mail. */
function formatBodyHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br />');
}

function normalizeHex(raw?: string | null, fallback = '#1d65a0'): string {
  const v = String(raw ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toUpperCase();
  }
  return fallback;
}

function isHttpUrl(raw?: string | null): boolean {
  const v = String(raw ?? '').trim();
  return /^https?:\/\//i.test(v);
}

/** Cuerpo plano más legible (fallback clientes sin HTML). */
export function buildNotificationEmailText(input: MailTemplateInput): string {
  const shop = (input.shopName ?? '').trim() || 'Tu local';
  const meta = TYPE_META[String(input.type)] ?? FALLBACK_META;
  const lines = [
    shop,
    '',
    input.title,
    '—'.repeat(Math.min(40, Math.max(8, input.title.length))),
    '',
    input.body,
    '',
    meta.hint,
  ];
  if (input.actionUrl) {
    lines.push('', `${input.actionLabel || 'Abrir'}: ${input.actionUrl}`);
  }
  lines.push('', `—`, `Enviado por ${shop}`);
  return lines.join('\n');
}

/**
 * HTML responsive con tablas + estilos inline (compatible con Gmail / Outlook).
 */
export function buildNotificationEmailHtml(input: MailTemplateInput): string {
  const meta = TYPE_META[String(input.type)] ?? FALLBACK_META;
  const brand = normalizeHex(input.accentColor, meta.tone);
  const shopName = escapeHtml((input.shopName ?? '').trim() || 'Notificación');
  const title = escapeHtml(input.title);
  const body = formatBodyHtml(input.body);
  const recipient = escapeHtml((input.recipientName ?? '').trim());
  const greeting = recipient ? `Hola ${recipient},` : 'Hola,';
  const logoUrl = isHttpUrl(input.shopLogoUrl) ? String(input.shopLogoUrl).trim() : '';
  const actionUrl = isHttpUrl(input.actionUrl) ? String(input.actionUrl).trim() : '';
  const actionLabel = escapeHtml(input.actionLabel || 'Ver en la app');
  const year = new Date().getFullYear();

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="56" height="56" alt="${shopName}" style="display:block;border-radius:14px;border:0;object-fit:cover;" />`
    : `<div style="width:56px;height:56px;border-radius:14px;background:${brand};color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;line-height:56px;text-align:center;">${shopName.slice(0, 1).toUpperCase()}</div>`;

  const actionBlock = actionUrl
    ? `
      <tr>
        <td style="padding:0 32px 28px;">
          <a href="${escapeHtml(actionUrl)}"
             style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;padding:14px 22px;border-radius:10px;">
            ${actionLabel}
          </a>
        </td>
      </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f0;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${body}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2f0;margin:0;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #d7e0d9;">
          <tr>
            <td style="height:6px;background:${brand};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td width="64" valign="middle">${logoBlock}</td>
                  <td valign="middle" style="padding-left:14px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5f6f76;font-weight:700;">
                      ${escapeHtml(meta.label)}
                    </div>
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:#1b2a33;font-weight:700;padding-top:2px;">
                      ${shopName}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px;">
              <span style="display:inline-block;background:${meta.toneSoft};color:${meta.tone};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:6px 10px;border-radius:999px;">
                ${escapeHtml(meta.label)} · aviso
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 32px 6px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#5f6f76;line-height:1.4;">
                ${greeting}
              </div>
              <h1 style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.25;color:#1b2a33;font-weight:800;">
                ${title}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f7faf8;border:1px solid #e4ebe6;border-radius:14px;">
                <tr>
                  <td width="6" style="background:${meta.tone};border-radius:14px 0 0 14px;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="padding:18px 18px 18px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1b2a33;">
                    ${body}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#5f6f76;">
              ${escapeHtml(meta.hint)}
            </td>
          </tr>
          ${actionBlock}
          <tr>
            <td style="padding:0 32px;">
              <div style="height:1px;background:#e4ebe6;line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8a9a96;">
              Este aviso lo envió <strong style="color:#5f6f76;">${shopName}</strong> desde el sistema de gestión.
              Si no corresponde, podés ignorarlo o pedir que te saquen de las notificaciones por correo.
              <div style="padding-top:10px;">© ${year} ${shopName}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
