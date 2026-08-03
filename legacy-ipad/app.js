/* Cierres legacy — ES5 estricto para Safari iOS 9.3.5 */
(function () {
  'use strict';

  var cfg = window.CRC_LEGACY_CONFIG || {};
  var API = cfg.apiUrl || '/api/v1';
  var TOKEN_KEY = cfg.tokenKey || 'crc_legacy_token';
  var USER_KEY = cfg.userKey || 'crc_legacy_user';
  var SHOP_KEY = cfg.shopKey || 'crc_legacy_shop';

  var EXPENSE_CATEGORIES = [
    { value: 'RAW_MATERIALS', label: 'Materia prima' },
    { value: 'DRINKS', label: 'Bebida' },
    { value: 'SALARIES', label: 'Sueldos' },
    { value: 'COMMISSIONS', label: 'Comisiones' },
    { value: 'RENT', label: 'Alquiler' },
    { value: 'EQUIPMENT', label: 'Equipamiento' },
    { value: 'CLEANING', label: 'Limpieza' },
    { value: 'DISPOSABLES', label: 'Descartables' },
    { value: 'UTILITIES', label: 'Servicios' },
    { value: 'MARKETING', label: 'Marketing' },
    { value: 'SUPPLIES', label: 'Insumos' },
    { value: 'SERVICES', label: 'Servicios' },
    { value: 'TRANSFER_SHOP', label: 'Transferencia locales' },
    { value: 'OTHER', label: 'Otros' }
  ];

  var POSNET_TYPES = [
    { value: 'PVS', label: 'PVS' },
    { value: 'MERCADO_PAGO', label: 'Mercado Pago' },
    { value: 'CUENTA_DNI', label: 'Cuenta DNI' }
  ];

  var state = {
    user: null,
    shops: [],
    shopId: null,
    users: [],
    view: 'boot',
    alert: null,
    list: [],
    editing: null,
    form: null,
    panels: {
      posnets: false,
      dni: false,
      other: false,
      withdraw: false,
      expenses: false
    },
    busy: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function money(n) {
    var v = Number(n);
    if (isNaN(v)) v = 0;
    return '$ ' + v.toFixed(2);
  }

  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function newId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function parseOpeningMins(openingTime) {
    var raw = String(openingTime || '10:00').trim();
    var m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 10 * 60;
    var h = Math.min(23, Math.max(0, Number(m[1])));
    var min = Math.min(59, Math.max(0, Number(m[2])));
    return h * 60 + min;
  }

  function resolveBusinessDate(shop) {
    var now = new Date();
    var opening = parseOpeningMins(shop && shop.openingTime);
    if (now.getHours() * 60 + now.getMinutes() < opening) {
      now = new Date(now.getTime() - 86400000);
    }
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function formatDateDisplay(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso || '';
    return Number(m[3]) + '/' + Number(m[2]) + '/' + m[1];
  }

  function statusLabel(s) {
    if (s === 'LOCKED') return 'Bloqueado';
    if (s === 'SUBMITTED') return 'Enviado';
    if (s === 'DRAFT') return 'Borrador';
    return s || '';
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null;
    }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function saveUser(u) {
    try {
      if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
      else localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function loadUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveShopId(id) {
    try {
      if (id) localStorage.setItem(SHOP_KEY, id);
      else localStorage.removeItem(SHOP_KEY);
    } catch (e) {}
  }

  function loadShopId() {
    try {
      return localStorage.getItem(SHOP_KEY);
    } catch (e) {
      return null;
    }
  }

  function currentShop() {
    var i;
    for (i = 0; i < state.shops.length; i++) {
      if (state.shops[i].id === state.shopId) return state.shops[i];
    }
    return null;
  }

  function hasPerm(perm) {
    var u = state.user;
    if (!u) return false;
    if (u.globalRole === 'OWNER' || u.globalRole === 'ADMIN') return true;
    var list = [];
    if (u.shopPermissions && state.shopId && u.shopPermissions[state.shopId]) {
      list = u.shopPermissions[state.shopId];
    } else if (u.permissions) {
      list = u.permissions;
    }
    return list.indexOf(perm) !== -1;
  }

  function canCreate() {
    return hasPerm('closings.create');
  }

  function canUpdate() {
    return hasPerm('closings.update');
  }

  function canRead() {
    return hasPerm('closings.read') || canCreate();
  }

  function xhr(method, path, body, cb) {
    var req = new XMLHttpRequest();
    req.open(method, API + path, true);
    req.setRequestHeader('Accept', 'application/json');
    if (body != null) req.setRequestHeader('Content-Type', 'application/json');
    var token = getToken();
    if (token) req.setRequestHeader('Authorization', 'Bearer ' + token);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      var data = null;
      var text = req.responseText || '';
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { message: text };
        }
      }
      if (req.status >= 200 && req.status < 300) {
        cb(null, data, req.status);
      } else {
        var msg = 'Error ' + req.status;
        if (data) {
          if (typeof data.message === 'string') msg = data.message;
          else if (data.message && data.message.join) msg = data.message.join(', ');
          else if (data.error) msg = data.error;
        }
        if (req.status === 401) {
          logout(false);
          state.alert = { type: 'error', text: 'Sesión expirada. Iniciá sesión de nuevo.' };
          render();
          return;
        }
        cb({ status: req.status, message: msg, data: data }, null, req.status);
      }
    };
    req.onerror = function () {
      cb({ status: 0, message: 'Sin conexión con el servidor' }, null, 0);
    };
    req.send(body != null ? JSON.stringify(body) : null);
  }

  function setAlert(type, text) {
    state.alert = text ? { type: type, text: text } : null;
  }

  function logout(rerender) {
    setToken(null);
    saveUser(null);
    state.user = null;
    state.shops = [];
    state.shopId = null;
    state.list = [];
    state.editing = null;
    state.form = null;
    state.view = 'login';
    if (rerender !== false) render();
  }

  function sumByType(rows, type) {
    var i;
    var t = 0;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].type === type) t += num(rows[i].amount);
    }
    return t;
  }

  function syncDerived(form) {
    var hasPvs = false;
    var hasMp = false;
    var hasDni = false;
    var i;
    for (i = 0; i < form.posnetAmounts.length; i++) {
      if (form.posnetAmounts[i].type === 'PVS') hasPvs = true;
      if (form.posnetAmounts[i].type === 'MERCADO_PAGO') hasMp = true;
      if (form.posnetAmounts[i].type === 'CUENTA_DNI') hasDni = true;
    }
    for (i = 0; i < form.dniTransfers.length; i++) {
      if (num(form.dniTransfers[i].amount) > 0 || String(form.dniTransfers[i].label || '').trim()) {
        hasDni = true;
      }
    }
    if (hasPvs) form.cardAmount = sumByType(form.posnetAmounts, 'PVS');
    if (hasMp) form.mercadoPagoAmount = sumByType(form.posnetAmounts, 'MERCADO_PAGO');
    if (hasDni) {
      form.accountDniAmount =
        sumByType(form.posnetAmounts, 'CUENTA_DNI') +
        (function () {
          var s = 0;
          var j;
          for (j = 0; j < form.dniTransfers.length; j++) s += num(form.dniTransfers[j].amount);
          return s;
        })();
    }
    form._locks = { card: hasPvs, mp: hasMp, dni: hasDni };
    form.declaredTotal =
      num(form.cardAmount) +
      num(form.cashAmount) +
      num(form.mercadoPagoAmount) +
      num(form.deliveryAppsAmount) +
      num(form.transferAmount) +
      num(form.accountDniAmount) +
      num(form.otherAmount);
    form.difference = num(form.posSystemAmount) - num(form.declaredTotal);
  }

  function emptyForm(shop, closing) {
    var c = closing || {};
    var configured = (shop && shop.posnets) || [];
    var posnets = [];
    var dniTransfers = [];
    var i;

    if (c.posnetAmounts && c.posnetAmounts.length) {
      for (i = 0; i < c.posnetAmounts.length; i++) {
        var p = c.posnetAmounts[i];
        if (p.type === 'CUENTA_DNI' && String(p.name || '').indexOf('Transferencia') === 0 && !isConfiguredPosnetId(configured, p.posnetId)) {
          dniTransfers.push({ id: p.posnetId || newId(), label: p.name, amount: num(p.amount) });
        } else {
          posnets.push({
            posnetId: p.posnetId || newId(),
            name: p.name || '',
            type: p.type || 'PVS',
            amount: num(p.amount),
            configured: isConfiguredPosnetId(configured, p.posnetId)
          });
        }
      }
    } else {
      for (i = 0; i < configured.length; i++) {
        posnets.push({
          posnetId: configured[i].id,
          name: configured[i].name,
          type: configured[i].type,
          amount: 0,
          configured: true
        });
      }
    }

    var expenses = [];
    if (c.expenses && c.expenses.length) {
      for (i = 0; i < c.expenses.length; i++) {
        expenses.push({
          label: c.expenses[i].label || '',
          amount: num(c.expenses[i].amount),
          category: c.expenses[i].category || 'OTHER'
        });
      }
    }

    return {
      id: c.id || null,
      status: c.status || null,
      businessDate: c.businessDate || resolveBusinessDate(shop),
      posSystemAmount: num(c.posSystemAmount),
      cardAmount: num(c.cardAmount),
      cashAmount: num(c.cashAmount),
      mercadoPagoAmount: num(c.mercadoPagoAmount),
      deliveryAppsAmount: num(c.deliveryAppsAmount),
      transferAmount: num(c.transferAmount),
      accountDniAmount: num(c.accountDniAmount),
      otherAmount: num(c.otherAmount),
      unitsSold: c.unitsSold == null ? '' : c.unitsSold,
      coversCount: c.coversCount == null ? '' : c.coversCount,
      cashLeftInRegister: c.cashLeftInRegister != null ? num(c.cashLeftInRegister) : num(shop && shop.defaultChangeAmount),
      cashWithdrawn: num(c.cashWithdrawn),
      cashWithdrawnByUserId: c.cashWithdrawnByUserId || '',
      cashWithdrawnToAccountId: c.cashWithdrawnToAccountId || '',
      tipsAmount: num(c.tipsAmount),
      notes: c.notes || '',
      differenceReason: c.differenceReason || '',
      posnetAmounts: posnets,
      dniTransfers: dniTransfers,
      expenses: expenses,
      declaredTotal: num(c.declaredTotal),
      difference: num(c.difference),
      _locks: { card: false, mp: false, dni: false }
    };
  }

  function isConfiguredPosnetId(configured, id) {
    var i;
    for (i = 0; i < configured.length; i++) {
      if (configured[i].id === id) return true;
    }
    return false;
  }

  function withdrawUsers() {
    var out = [];
    var i;
    for (i = 0; i < state.users.length; i++) {
      if (!state.users[i].hideFromCashWithdraw) out.push(state.users[i]);
    }
    return out;
  }

  function findUser(id) {
    var i;
    for (i = 0; i < state.users.length; i++) {
      if (state.users[i].id === id) return state.users[i];
    }
    return null;
  }

  function accountsForUser(userId) {
    var u = findUser(userId);
    return (u && u.ledgerAccounts) || [];
  }

  function readFormFromDom() {
    var f = state.form;
    if (!f) return;
    f.businessDate = val('f-date');
    f.posSystemAmount = num(val('f-pos'));
    f.cashAmount = num(val('f-cash'));
    f.cardAmount = num(val('f-card'));
    f.accountDniAmount = num(val('f-dni'));
    f.mercadoPagoAmount = num(val('f-mp'));
    f.deliveryAppsAmount = num(val('f-delivery'));
    f.transferAmount = num(val('f-transfer'));
    f.otherAmount = num(val('f-other'));
    f.unitsSold = val('f-units');
    f.coversCount = val('f-covers');
    f.cashLeftInRegister = num(val('f-change'));
    f.cashWithdrawn = num(val('f-withdrawn'));
    f.cashWithdrawnByUserId = val('f-who');
    f.cashWithdrawnToAccountId = val('f-account');
    f.tipsAmount = num(val('f-tips'));
    f.notes = val('f-notes');
    f.differenceReason = val('f-diff-reason');

    var i;
    for (i = 0; i < f.posnetAmounts.length; i++) {
      f.posnetAmounts[i].name = val('pn-name-' + i);
      f.posnetAmounts[i].type = val('pn-type-' + i) || f.posnetAmounts[i].type;
      f.posnetAmounts[i].amount = num(val('pn-amt-' + i));
    }
    for (i = 0; i < f.dniTransfers.length; i++) {
      f.dniTransfers[i].label = val('dni-label-' + i);
      f.dniTransfers[i].amount = num(val('dni-amt-' + i));
    }
    for (i = 0; i < f.expenses.length; i++) {
      f.expenses[i].label = val('ex-label-' + i);
      f.expenses[i].amount = num(val('ex-amt-' + i));
      f.expenses[i].category = val('ex-cat-' + i) || 'OTHER';
    }
    syncDerived(f);
  }

  function val(id) {
    var el = $(id);
    return el ? el.value : '';
  }

  function buildPayload() {
    readFormFromDom();
    var f = state.form;
    syncDerived(f);
    var userId = f.cashWithdrawnByUserId || null;
    var selected = findUser(userId);
    var accounts = accountsForUser(userId);
    var accountId = f.cashWithdrawnToAccountId || null;
    if (num(f.cashAmount) > 0 && userId && accounts.length > 1 && !accountId) {
      return { error: 'Seleccioná la cuenta destino del efectivo' };
    }
    if (accounts.length === 1) accountId = accounts[0].id;
    if (!userId) accountId = null;

    var posnetAmounts = [];
    var i;
    for (i = 0; i < f.posnetAmounts.length; i++) {
      var p = f.posnetAmounts[i];
      if (!String(p.name || '').trim() && num(p.amount) <= 0) continue;
      posnetAmounts.push({
        posnetId: p.posnetId || newId(),
        name: String(p.name || '').trim() || p.type || 'Posnet',
        type: p.type,
        amount: num(p.amount)
      });
    }
    for (i = 0; i < f.dniTransfers.length; i++) {
      var t = f.dniTransfers[i];
      if (!String(t.label || '').trim() && num(t.amount) <= 0) continue;
      posnetAmounts.push({
        posnetId: t.id || newId(),
        name: String(t.label || '').trim() || 'Transferencia Cuenta DNI',
        type: 'CUENTA_DNI',
        amount: num(t.amount)
      });
    }

    var expenses = [];
    for (i = 0; i < f.expenses.length; i++) {
      var e = f.expenses[i];
      if (String(e.label || '').trim() && num(e.amount) > 0) {
        expenses.push({
          label: String(e.label).trim(),
          amount: num(e.amount),
          category: e.category || 'OTHER'
        });
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.businessDate)) {
      return { error: 'Fecha inválida. Usá formato AAAA-MM-DD' };
    }

    return {
      body: {
        businessDate: f.businessDate,
        posSystemAmount: num(f.posSystemAmount),
        cardAmount: num(f.cardAmount),
        cashAmount: num(f.cashAmount),
        mercadoPagoAmount: num(f.mercadoPagoAmount),
        deliveryAppsAmount: num(f.deliveryAppsAmount),
        transferAmount: num(f.transferAmount),
        accountDniAmount: num(f.accountDniAmount),
        otherAmount: num(f.otherAmount),
        unitsSold: f.unitsSold === '' ? null : num(f.unitsSold),
        coversCount: f.coversCount === '' ? null : num(f.coversCount),
        cashLeftInRegister: num(f.cashLeftInRegister),
        cashWithdrawn: num(f.cashWithdrawn),
        cashWithdrawnByUserId: userId,
        cashWithdrawnByEmployeeId: null,
        cashWithdrawnByName: selected ? selected.fullName : null,
        cashWithdrawnToAccountId: accountId,
        tipsAmount: num(f.tipsAmount),
        notes: f.notes || null,
        differenceReason: f.differenceReason || null,
        declaredTotal: num(f.declaredTotal),
        posnetAmounts: posnetAmounts,
        expenses: expenses
      }
    };
  }

  function renderAlert() {
    if (!state.alert) return '';
    var cls = 'alert alert-error';
    if (state.alert.type === 'ok') cls = 'alert alert-ok';
    if (state.alert.type === 'warn') cls = 'alert alert-warn';
    return '<div class="' + cls + '">' + escapeHtml(state.alert.text) + '</div>';
  }

  function renderLogin() {
    return (
      '<div class="login-box">' +
      '<div class="card">' +
      '<h2>Cierres de caja</h2>' +
      '<p class="muted">Versión compatible con iPad antiguo</p>' +
      renderAlert() +
      '<div class="field"><label>Email</label><input id="login-email" type="email" autocomplete="username" /></div>' +
      '<div class="field"><label>Contraseña</label><input id="login-pass" type="password" autocomplete="current-password" /></div>' +
      '<button type="button" class="btn btn-primary btn-block" id="btn-login"' +
      (state.busy ? ' disabled' : '') +
      '>Ingresar</button>' +
      '</div></div>'
    );
  }

  function topbar(title) {
    var shop = currentShop();
    return (
      '<div class="topbar clearfix">' +
      '<h1>' +
      escapeHtml(title) +
      '</h1>' +
      '<div class="actions">' +
      (shop
        ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-shops">Local</button> '
        : '') +
      '<button type="button" class="btn btn-ghost btn-sm" id="btn-logout">Salir</button>' +
      '</div></div>'
    );
  }

  function renderHome() {
    var shop = currentShop();
    var html =
      topbar(shop ? shop.name : 'Cierres') +
      '<div class="wrap">' +
      renderAlert() +
      '<div class="card">' +
      '<p class="muted">' +
      escapeHtml((state.user && state.user.fullName) || '') +
      '</p>';
    if (canCreate()) {
      html +=
        '<button type="button" class="btn btn-primary btn-block" id="btn-new">Nuevo cierre</button>';
    }
    html +=
      '<button type="button" class="btn btn-block" id="btn-refresh-list">Actualizar listado</button>' +
      '</div><div class="card"><h2>Últimos cierres</h2>';
    if (!state.list.length) {
      html += '<p class="muted">No hay cierres recientes.</p>';
    } else {
      var i;
      for (i = 0; i < state.list.length; i++) {
        var c = state.list[i];
        var badge =
          c.status === 'LOCKED'
            ? 'badge badge-locked'
            : c.status === 'SUBMITTED'
              ? 'badge badge-ok'
              : 'badge';
        html +=
          '<div class="list-item clearfix" data-id="' +
          escapeHtml(c.id) +
          '">' +
          '<div class="meta">' +
          '<strong>' +
          escapeHtml(formatDateDisplay(c.businessDate)) +
          '</strong>' +
          '<span class="' +
          badge +
          '">' +
          escapeHtml(statusLabel(c.status)) +
          '</span>' +
          '</div>' +
          '<div class="side">' +
          '<div>' +
          escapeHtml(money(c.declaredTotal)) +
          '</div>' +
          '<button type="button" class="btn btn-sm btn-open" data-id="' +
          escapeHtml(c.id) +
          '">Abrir</button>' +
          '</div></div>';
      }
    }
    html += '</div></div>';
    return html;
  }

  function optList(items, valueKey, labelKey, selected, emptyLabel) {
    var html = '';
    if (emptyLabel != null) {
      html += '<option value="">' + escapeHtml(emptyLabel) + '</option>';
    }
    var i;
    for (i = 0; i < items.length; i++) {
      var v = items[i][valueKey];
      var lab = items[i][labelKey];
      html +=
        '<option value="' +
        escapeHtml(v) +
        '"' +
        (String(v) === String(selected) ? ' selected' : '') +
        '>' +
        escapeHtml(lab) +
        '</option>';
    }
    return html;
  }

  function renderShopPicker() {
    return (
      topbar('Elegir local') +
      '<div class="wrap">' +
      renderAlert() +
      '<div class="card"><h2>Locales</h2>' +
      (function () {
        var html = '';
        var i;
        for (i = 0; i < state.shops.length; i++) {
          var s = state.shops[i];
          html +=
            '<button type="button" class="btn btn-block btn-pick-shop" data-id="' +
            escapeHtml(s.id) +
            '">' +
            escapeHtml(s.name) +
            '</button>';
        }
        return html;
      })() +
      '</div></div>'
    );
  }

  function field(id, label, value, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var ro = opts.readonly ? ' readonly' : '';
    var step = opts.step ? ' step="' + opts.step + '"' : '';
    if (opts.textarea) {
      return (
        '<div class="field"><label for="' +
        id +
        '">' +
        escapeHtml(label) +
        '</label><textarea id="' +
        id +
        '"' +
        ro +
        '>' +
        escapeHtml(value) +
        '</textarea></div>'
      );
    }
    return (
      '<div class="field"><label for="' +
      id +
      '">' +
      escapeHtml(label) +
      '</label><input id="' +
      id +
      '" type="' +
      type +
      '" value="' +
      escapeHtml(value) +
      '"' +
      step +
      ro +
      ' /></div>'
    );
  }

  function panel(key, title, hint, bodyHtml) {
    var open = state.panels[key] ? ' open' : '';
    return (
      '<div class="panel' +
      open +
      '" data-panel="' +
      key +
      '">' +
      '<button type="button" class="panel-toggle" data-panel="' +
      key +
      '">' +
      escapeHtml(title) +
      '<span class="hint">' +
      escapeHtml(hint) +
      '</span></button>' +
      '<div class="panel-body">' +
      bodyHtml +
      '</div></div>'
    );
  }

  function renderForm() {
    var f = state.form;
    var shop = currentShop();
    syncDerived(f);
    var isEdit = !!f.id;
    var canSave =
      !state.busy &&
      ((isEdit && canUpdate() && f.status !== 'LOCKED') || (!isEdit && canCreate()));

    var accounts = accountsForUser(f.cashWithdrawnByUserId);
    var whoOpts = optList(withdrawUsers(), 'id', 'fullName', f.cashWithdrawnByUserId, '— Sin asignar —');

    var summary =
      '<div class="summary clearfix">' +
      '<div class="item"><span>Fecha</span><strong>' +
      escapeHtml(formatDateDisplay(f.businessDate)) +
      '</strong></div>' +
      '<div class="item"><span>PVS</span><strong>' +
      escapeHtml(money(f.cardAmount)) +
      '</strong></div>' +
      '<div class="item"><span>Efectivo</span><strong>' +
      escapeHtml(money(f.cashAmount)) +
      '</strong></div>' +
      '<div class="item"><span>Cuenta DNI</span><strong>' +
      escapeHtml(money(f.accountDniAmount)) +
      '</strong></div>' +
      '<div class="item"><span>Caja sistema</span><strong>' +
      escapeHtml(money(f.posSystemAmount)) +
      '</strong></div>' +
      '<div class="item total"><span>Total declarado</span><strong>' +
      escapeHtml(money(f.declaredTotal)) +
      '</strong></div></div>';

    var main =
      '<div class="card"><h2>Cobros del día</h2>' +
      field('f-date', 'Fecha (AAAA-MM-DD)', f.businessDate, { type: 'text' }) +
      '<div class="row clearfix">' +
      '<div class="col">' +
      field('f-pos', 'Caja (sistema)', f.posSystemAmount, { type: 'number', step: '0.01' }) +
      '</div><div class="col">' +
      field('f-cash', 'Efectivo', f.cashAmount, { type: 'number', step: '0.01' }) +
      '</div></div>' +
      '<div class="row clearfix">' +
      '<div class="col">' +
      field('f-card', 'PVS' + (f._locks.card ? ' (suma)' : ''), f.cardAmount, {
        type: 'number',
        step: '0.01',
        readonly: f._locks.card
      }) +
      '</div><div class="col">' +
      field('f-dni', 'Cuenta DNI' + (f._locks.dni ? ' (suma)' : ''), f.accountDniAmount, {
        type: 'number',
        step: '0.01',
        readonly: f._locks.dni
      }) +
      '</div></div>' +
      '<div class="field"><label for="f-who">Quién se lo lleva</label><select id="f-who">' +
      whoOpts +
      '</select></div>';

    if (accounts.length > 1) {
      main +=
        '<div class="field"><label for="f-account">Cuenta destino</label><select id="f-account">' +
        optList(accounts, 'id', 'name', f.cashWithdrawnToAccountId, '— Elegir —') +
        '</select></div>';
    } else {
      main += '<input type="hidden" id="f-account" value="' + escapeHtml(f.cashWithdrawnToAccountId || (accounts[0] && accounts[0].id) || '') + '" />';
      if (accounts.length === 1) {
        main += '<p class="muted">Cuenta destino: ' + escapeHtml(accounts[0].name) + '</p>';
      }
    }
    main += '</div>';

    var posBody = '<div class="toolbar"><button type="button" class="btn btn-sm" id="btn-add-posnet">Agregar posnet</button></div>';
    var i;
    for (i = 0; i < f.posnetAmounts.length; i++) {
      var p = f.posnetAmounts[i];
      posBody +=
        '<div class="dyn-row" data-pi="' +
        i +
        '">' +
        field('pn-name-' + i, 'Nombre', p.name, { readonly: !!p.configured }) +
        '<div class="field"><label>Tipo</label><select id="pn-type-' +
        i +
        '"' +
        (p.configured ? ' disabled' : '') +
        '>' +
        optList(POSNET_TYPES, 'value', 'label', p.type) +
        '</select></div>' +
        field('pn-amt-' + i, 'Monto', p.amount, { type: 'number', step: '0.01' }) +
        (p.configured
          ? ''
          : '<button type="button" class="btn btn-sm btn-danger btn-rm-posnet" data-i="' + i + '">Quitar</button>') +
        '</div>';
    }

    var dniBody = '<div class="toolbar"><button type="button" class="btn btn-sm" id="btn-add-dni">Agregar transferencia</button></div>';
    for (i = 0; i < f.dniTransfers.length; i++) {
      var d = f.dniTransfers[i];
      dniBody +=
        '<div class="dyn-row">' +
        field('dni-label-' + i, 'Detalle', d.label) +
        field('dni-amt-' + i, 'Monto', d.amount, { type: 'number', step: '0.01' }) +
        '<button type="button" class="btn btn-sm btn-danger btn-rm-dni" data-i="' +
        i +
        '">Quitar</button></div>';
    }

    var otherBody =
      field('f-mp', 'MercadoPago' + (f._locks.mp ? ' (suma)' : ''), f.mercadoPagoAmount, {
        type: 'number',
        step: '0.01',
        readonly: f._locks.mp
      }) +
      field('f-delivery', 'PedidosYa / delivery', f.deliveryAppsAmount, { type: 'number', step: '0.01' }) +
      field('f-transfer', 'Transferencia', f.transferAmount, { type: 'number', step: '0.01' }) +
      field('f-other', 'Otros', f.otherAmount, { type: 'number', step: '0.01' });

    var withdrawBody = '';
    if (shop && shop.unitsLabel) {
      withdrawBody += field('f-units', shop.unitsLabel, f.unitsSold, { type: 'number' });
    } else {
      withdrawBody += '<input type="hidden" id="f-units" value="' + escapeHtml(f.unitsSold) + '" />';
    }
    if (shop && shop.coversEnabled) {
      withdrawBody += field('f-covers', 'Comensales', f.coversCount, { type: 'number' });
    } else {
      withdrawBody += '<input type="hidden" id="f-covers" value="' + escapeHtml(f.coversCount) + '" />';
    }
    withdrawBody +=
      field('f-change', 'Cambio en caja', f.cashLeftInRegister, { type: 'number', step: '0.01' }) +
      field('f-withdrawn', 'Efectivo retirado', f.cashWithdrawn, { type: 'number', step: '0.01' }) +
      field('f-tips', 'Propinas', f.tipsAmount, { type: 'number', step: '0.01' }) +
      field('f-notes', 'Notas', f.notes, { textarea: true }) +
      field('f-diff-reason', 'Motivo diferencia', f.differenceReason);

    var exBody = '<div class="toolbar"><button type="button" class="btn btn-sm" id="btn-add-ex">Agregar egreso</button></div>';
    for (i = 0; i < f.expenses.length; i++) {
      var e = f.expenses[i];
      exBody +=
        '<div class="dyn-row">' +
        field('ex-label-' + i, 'Concepto', e.label) +
        field('ex-amt-' + i, 'Monto', e.amount, { type: 'number', step: '0.01' }) +
        '<div class="field"><label>Categoría</label><select id="ex-cat-' +
        i +
        '">' +
        optList(EXPENSE_CATEGORIES, 'value', 'label', e.category) +
        '</select></div>' +
        '<button type="button" class="btn btn-sm btn-danger btn-rm-ex" data-i="' +
        i +
        '">Quitar</button></div>';
    }

    var warn = '';
    if (f.status === 'LOCKED') {
      warn = '<div class="alert alert-warn">Este cierre está bloqueado. Solo lectura en iPad.</div>';
    } else if (isEdit && !canUpdate()) {
      warn = '<div class="alert alert-warn">Solo lectura: tu usuario no puede editar cierres.</div>';
      canSave = false;
    }

    return (
      topbar(isEdit ? 'Editar cierre' : 'Nuevo cierre') +
      '<div class="wrap">' +
      renderAlert() +
      warn +
      summary +
      main +
      panel('posnets', 'Posnets', f.posnetAmounts.length ? f.posnetAmounts.length + ' líneas' : 'Opcional', posBody) +
      panel('dni', 'Transferencias Cuenta DNI', f.dniTransfers.length ? f.dniTransfers.length + ' líneas' : 'Opcional', dniBody) +
      panel('other', 'Otros cobros', 'MP, delivery, transferencias', otherBody) +
      panel('withdraw', 'Retiro y extras', 'Cambio, propinas, notas', withdrawBody) +
      panel('expenses', 'Egresos del día', f.expenses.length ? f.expenses.length + ' egresos' : 'Opcional', exBody) +
      '<div class="footer-actions">' +
      (canSave
        ? '<button type="button" class="btn btn-primary btn-block" id="btn-save">' +
          (isEdit ? 'Guardar cambios' : 'Guardar cierre') +
          '</button>'
        : '') +
      '<button type="button" class="btn btn-block" id="btn-back">Volver</button>' +
      '</div></div>'
    );
  }

  function render() {
    var root = $('app');
    if (!root) return;
    var html = '';
    if (state.view === 'login') html = renderLogin();
    else if (state.view === 'shops') html = renderShopPicker();
    else if (state.view === 'form') html = renderForm();
    else html = renderHome();
    root.innerHTML = html;
    bind();
  }

  function bind() {
    var el;
    el = $('btn-login');
    if (el) el.onclick = onLogin;
    el = $('btn-logout');
    if (el) el.onclick = function () {
      logout(true);
    };
    el = $('btn-shops');
    if (el)
      el.onclick = function () {
        state.view = 'shops';
        setAlert(null);
        render();
      };
    el = $('btn-new');
    if (el) el.onclick = onNew;
    el = $('btn-refresh-list');
    if (el) el.onclick = function () {
      loadList(true);
    };
    el = $('btn-back');
    if (el)
      el.onclick = function () {
        state.form = null;
        state.editing = null;
        state.view = 'home';
        setAlert(null);
        render();
      };
    el = $('btn-save');
    if (el) el.onclick = onSave;
    el = $('btn-add-posnet');
    if (el)
      el.onclick = function () {
        readFormFromDom();
        state.form.posnetAmounts.push({
          posnetId: newId(),
          name: '',
          type: 'PVS',
          amount: 0,
          configured: false
        });
        state.panels.posnets = true;
        render();
      };
    el = $('btn-add-dni');
    if (el)
      el.onclick = function () {
        readFormFromDom();
        state.form.dniTransfers.push({ id: newId(), label: '', amount: 0 });
        state.panels.dni = true;
        render();
      };
    el = $('btn-add-ex');
    if (el)
      el.onclick = function () {
        readFormFromDom();
        state.form.expenses.push({ label: '', amount: 0, category: 'OTHER' });
        state.panels.expenses = true;
        render();
      };
    el = $('f-who');
    if (el)
      el.onchange = function () {
        readFormFromDom();
        var accounts = accountsForUser(state.form.cashWithdrawnByUserId);
        state.form.cashWithdrawnToAccountId = accounts.length === 1 ? accounts[0].id : '';
        render();
      };

    bindClicks(document.getElementsByClassName('btn-pick-shop'), function (btn) {
      selectShop(btn.getAttribute('data-id'));
    });
    bindClicks(document.getElementsByClassName('btn-open'), function (btn) {
      openClosing(btn.getAttribute('data-id'));
    });
    bindClicks(document.getElementsByClassName('panel-toggle'), function (btn) {
      var key = btn.getAttribute('data-panel');
      readFormFromDom();
      state.panels[key] = !state.panels[key];
      render();
    });
    bindClicks(document.getElementsByClassName('btn-rm-posnet'), function (btn) {
      var i = Number(btn.getAttribute('data-i'));
      readFormFromDom();
      state.form.posnetAmounts.splice(i, 1);
      render();
    });
    bindClicks(document.getElementsByClassName('btn-rm-dni'), function (btn) {
      var i = Number(btn.getAttribute('data-i'));
      readFormFromDom();
      state.form.dniTransfers.splice(i, 1);
      render();
    });
    bindClicks(document.getElementsByClassName('btn-rm-ex'), function (btn) {
      var i = Number(btn.getAttribute('data-i'));
      readFormFromDom();
      state.form.expenses.splice(i, 1);
      render();
    });

    // Recalc summary on blur of money fields
    var moneyIds = ['f-pos', 'f-cash', 'f-card', 'f-dni', 'f-mp', 'f-delivery', 'f-transfer', 'f-other'];
    var mi;
    for (mi = 0; mi < moneyIds.length; mi++) {
      (function (id) {
        var input = $(id);
        if (!input) return;
        input.onblur = function () {
          readFormFromDom();
          render();
        };
      })(moneyIds[mi]);
    }
  }

  function bindClicks(nodes, fn) {
    var i;
    for (i = 0; i < nodes.length; i++) {
      (function (node) {
        node.onclick = function () {
          fn(node);
        };
      })(nodes[i]);
    }
  }

  function onLogin() {
    var email = val('login-email');
    var password = val('login-pass');
    if (!email || !password) {
      setAlert('error', 'Completá email y contraseña');
      render();
      return;
    }
    state.busy = true;
    setAlert(null);
    render();
    xhr('POST', '/auth/login', { email: email, password: password }, function (err, data) {
      if (err) {
        state.busy = false;
        setAlert('error', err.message || 'No se pudo ingresar');
        render();
        return;
      }
      setToken(data.accessToken);
      xhr('GET', '/auth/me', null, function (err2, me) {
        state.busy = false;
        if (err2) {
          setAlert('error', err2.message || 'No se pudo cargar el perfil');
          logout(false);
          render();
          return;
        }
        state.user = me;
        saveUser(me);
        state.shops = me.shops || [];
        if (!state.shops.length) {
          setAlert('error', 'Tu usuario no tiene locales asignados');
          logout(false);
          render();
          return;
        }
        var preferred = loadShopId();
        var found = false;
        var i;
        for (i = 0; i < state.shops.length; i++) {
          if (state.shops[i].id === preferred) found = true;
        }
        if (state.shops.length === 1) {
          selectShop(state.shops[0].id);
        } else if (found) {
          selectShop(preferred);
        } else {
          state.view = 'shops';
          render();
        }
      });
    });
  }

  function selectShop(id) {
    state.shopId = id;
    saveShopId(id);
    state.view = 'home';
    setAlert(null);
    render();
    loadUsers();
    loadList(false);
  }

  function loadUsers() {
    if (!state.shopId) return;
    xhr('GET', '/shops/' + state.shopId + '/users', null, function (err, data) {
      if (!err) state.users = data || [];
    });
  }

  function loadList(showMsg) {
    if (!state.shopId) return;
    if (!canRead()) {
      setAlert('error', 'Sin permiso para ver cierres');
      render();
      return;
    }
    state.busy = true;
    if (showMsg) setAlert(null);
    render();
    xhr('GET', '/shops/' + state.shopId + '/closings', null, function (err, data) {
      state.busy = false;
      if (err) {
        setAlert('error', err.message || 'No se pudo listar');
        render();
        return;
      }
      state.list = (data || []).slice(0, 30);
      if (showMsg) setAlert('ok', 'Listado actualizado');
      render();
    });
  }

  function onNew() {
    if (!canCreate()) {
      setAlert('error', 'Sin permiso para crear cierres');
      render();
      return;
    }
    state.editing = null;
    state.form = emptyForm(currentShop(), null);
    state.panels = { posnets: false, dni: false, other: false, withdraw: false, expenses: false };
    if (state.form.posnetAmounts.length) state.panels.posnets = true;
    state.view = 'form';
    setAlert(null);
    render();
  }

  function openClosing(id) {
    state.busy = true;
    setAlert(null);
    render();
    xhr('GET', '/shops/' + state.shopId + '/closings/' + id, null, function (err, data) {
      state.busy = false;
      if (err) {
        setAlert('error', err.message || 'No se pudo abrir');
        state.view = 'home';
        render();
        return;
      }
      state.editing = data;
      state.form = emptyForm(currentShop(), data);
      state.panels = {
        posnets: !!(data.posnetAmounts && data.posnetAmounts.length),
        dni: false,
        other:
          num(data.mercadoPagoAmount) > 0 ||
          num(data.deliveryAppsAmount) > 0 ||
          num(data.transferAmount) > 0,
        withdraw: true,
        expenses: !!(data.expenses && data.expenses.length)
      };
      state.view = 'form';
      render();
    });
  }

  function onSave() {
    var built = buildPayload();
    if (built.error) {
      setAlert('error', built.error);
      render();
      return;
    }
    var isEdit = !!(state.form && state.form.id);
    if (isEdit && state.form.status === 'LOCKED') {
      setAlert('error', 'El cierre está bloqueado');
      render();
      return;
    }
    if (!window.confirm(isEdit ? '¿Guardar cambios del cierre?' : '¿Confirmar y guardar el cierre?')) {
      return;
    }
    state.busy = true;
    setAlert(null);
    render();
    var path = '/shops/' + state.shopId + '/closings';
    var method = 'POST';
    if (isEdit) {
      method = 'PATCH';
      path += '/' + state.form.id;
    }
    xhr(method, path, built.body, function (err, data) {
      state.busy = false;
      if (err) {
        setAlert('error', err.message || 'No se pudo guardar');
        render();
        return;
      }
      if (!isEdit && canCreate() && !canUpdate()) {
        // Cajero: reset form for next closing
        setAlert('ok', 'Cierre guardado (' + formatDateDisplay(data.businessDate) + ')');
        state.form = emptyForm(currentShop(), null);
        state.editing = null;
        state.panels = { posnets: !!(state.form.posnetAmounts.length), dni: false, other: false, withdraw: false, expenses: false };
        state.view = 'form';
        render();
        loadList(false);
        return;
      }
      setAlert('ok', 'Cierre guardado');
      state.form = null;
      state.editing = null;
      state.view = 'home';
      render();
      loadList(false);
    });
  }

  function boot() {
    var token = getToken();
    var user = loadUser();
    if (!token || !user) {
      state.view = 'login';
      render();
      return;
    }
    state.user = user;
    xhr('GET', '/auth/me', null, function (err, me) {
      if (err) {
        logout(false);
        setAlert('error', 'Sesión inválida');
        render();
        return;
      }
      state.user = me;
      saveUser(me);
      state.shops = me.shops || [];
      if (!state.shops.length) {
        logout(false);
        setAlert('error', 'Sin locales asignados');
        render();
        return;
      }
      var preferred = loadShopId();
      var found = false;
      var i;
      for (i = 0; i < state.shops.length; i++) {
        if (state.shops[i].id === preferred) found = true;
      }
      if (state.shops.length === 1) selectShop(state.shops[0].id);
      else if (found) selectShop(preferred);
      else {
        state.view = 'shops';
        render();
      }
    });
  }

  boot();
})();
