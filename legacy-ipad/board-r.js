/* Tablero público de reservas — ES5 para iPad antiguo */
(function () {
  'use strict';

  var cfg = window.CRC_LEGACY_CONFIG || {};
  var API = cfg.apiUrl || '/api/v1';
  var slug = resolveSlug();
  var board = null;
  var busy = false;
  var toastTimer = null;
  var pollTimer = null;

  function resolveSlug() {
    var q = (location.search || '').match(/[?&]slug=([^&]+)/);
    if (q) {
      try {
        return decodeURIComponent(q[1].replace(/\+/g, ' '));
      } catch (e) {
        return q[1];
      }
    }
    var path = location.pathname || '';
    var m = path.match(/\/(?:legacy|ipad)\/r\/([^\/]+)\/?$/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch (e2) {
        return m[1];
      }
    }
    return '';
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function xhr(method, url, body, cb) {
    var req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Accept', 'application/json');
    if (body != null) {
      req.setRequestHeader('Content-Type', 'application/json');
    }
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      var data = null;
      if (req.responseText) {
        try {
          data = JSON.parse(req.responseText);
        } catch (e) {
          data = null;
        }
      }
      cb(req.status, data);
    };
    req.send(body != null ? JSON.stringify(body) : null);
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.className = 'board-toast';
    el.appendChild(document.createTextNode(msg));
    document.body.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  function sortRows(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var ra = a.removedAfterSeated ? 1 : 0;
      var rb = b.removedAfterSeated ? 1 : 0;
      if (ra !== rb) return ra - rb;
      var sa = a.status === 'SEATED' ? 2 : a.status === 'MARKED' ? 1 : 0;
      var sb = b.status === 'SEATED' ? 2 : b.status === 'MARKED' ? 1 : 0;
      if (sa !== sb) return sa - sb;
      var ta = a.reservationTime || '99:99';
      var tb = b.reservationTime || '99:99';
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      var na = a.number != null ? a.number : 999999;
      var nb = b.number != null ? b.number : 999999;
      return na - nb;
    });
  }

  function partyMix(rows) {
    var counts = {};
    var i;
    var n;
    var keys = [];
    for (i = 0; i < (rows || []).length; i++) {
      if (rows[i].removedAfterSeated) continue;
      n = Math.round(Number(rows[i].partySize) || 0);
      if (n < 1) continue;
      if (!counts[n]) {
        counts[n] = 0;
        keys.push(n);
      }
      counts[n] += 1;
    }
    keys.sort(function (a, b) {
      return a - b;
    });
    return keys.map(function (size) {
      return { partySize: size, tables: counts[size] };
    });
  }

  function formatMixItem(item) {
    var mesa = item.tables === 1 ? 'mesa' : 'mesas';
    var pers = item.partySize === 1 ? 'persona' : 'personas';
    return item.tables + ' ' + mesa + ' de ' + item.partySize + ' ' + pers;
  }

  function renderMixCol(label, items) {
    if (!items.length) return '';
    var chips = '';
    var i;
    for (i = 0; i < items.length; i++) {
      chips += '<span class="board-mix-chip">' + escapeHtml(formatMixItem(items[i])) + '</span>';
    }
    return (
      '<div class="board-mix-col"><p class="board-mix-label">' +
      escapeHtml(label) +
      '</p><p class="board-mix-chips">' +
      chips +
      '</p></div>'
    );
  }

  function renderMix(rows) {
    var inside = partyMix(
      (rows || []).filter(function (r) {
        return !r.removedAfterSeated && r.area !== 'OUTSIDE';
      }),
    );
    var outside = partyMix(
      (rows || []).filter(function (r) {
        return !r.removedAfterSeated && r.area === 'OUTSIDE';
      }),
    );
    if (!inside.length && !outside.length) return '';
    var both = inside.length && outside.length;
    return (
      '<section class="board-mix' +
      (both ? '' : ' board-mix-one') +
      '">' +
      renderMixCol('Adentro', inside) +
      renderMixCol('Afuera', outside) +
      '<div style="clear:both"></div></section>'
    );
  }

  function canToggle(r) {
    return !r.removedAfterSeated && (r.status === 'CONFIRMED' || r.status === 'MARKED' || r.status === 'SEATED');
  }

  function renderItem(r) {
    var cls = 'board-item';
    if (canToggle(r)) cls += ' board-item-tap';
    if (r.status === 'MARKED' && !r.removedAfterSeated) cls += ' board-item-marked';
    if (r.status === 'SEATED' && !r.removedAfterSeated) cls += ' board-item-seated';
    if (r.removedAfterSeated) cls += ' board-item-removed';

    var badges = '';
    if (r.status === 'MARKED' && !r.removedAfterSeated) {
      badges += '<span class="board-badge board-badge-marked">Marcada</span>';
    }
    if (r.status === 'SEATED' && !r.removedAfterSeated) {
      badges += '<span class="board-badge board-badge-seated">Sentada</span>';
    }
    if (r.removedAfterSeated) {
      badges += '<span class="board-badge board-badge-removed">Liberada</span>';
    }

    var note = r.notes && String(r.notes).replace(/^\s+|\s+$/g, '')
      ? '<span class="board-note">' + escapeHtml(r.notes) + '</span>'
      : '';

    var time = r.reservationTime
      ? '<span class="board-time">' + escapeHtml(r.reservationTime) + '</span>'
      : '';

    var dismiss = r.removedAfterSeated
      ? '<button type="button" class="board-dismiss" data-dismiss="' +
        escapeHtml(r.id) +
        '">✕</button>'
      : '';

    return (
      '<li class="' +
      cls +
      '" data-id="' +
      escapeHtml(r.id) +
      '">' +
      '<span class="board-name">' +
      (r.number != null ? '<span class="board-num">#' + escapeHtml(r.number) + '</span>' : '') +
      escapeHtml(r.guestName || 'Reserva') +
      badges +
      '</span>' +
      note +
      '<span class="board-meta">' +
      time +
      dismiss +
      '<span class="board-pax"><strong>' +
      escapeHtml(r.partySize) +
      '</strong><span>p</span></span>' +
      '</span></li>'
    );
  }

  function renderList(rows, emptyLabel) {
    if (!rows.length) {
      return '<li class="board-empty">' + escapeHtml(emptyLabel) + '</li>';
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) html += renderItem(rows[i]);
    return html;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    var months = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    var m = months[parseInt(p[1], 10) - 1] || p[1];
    return parseInt(p[2], 10) + ' de ' + m + ' de ' + p[0];
  }

  function render() {
    var root = $('app');
    if (!root) return;

    if (!slug) {
      root.innerHTML =
        '<div class="board-error"><p>Local no encontrado</p></div>';
      return;
    }

    if (!board) {
      root.innerHTML =
        '<div class="board-loading">Cargando reservas…</div>';
      return;
    }

    var b = board;
    var accent = (b.shop && b.shop.accentColor) || '#c45c26';
    var inside = sortRows(
      (b.reservations || []).filter(function (r) {
        return r.area !== 'OUTSIDE';
      }),
    );
    var outside = sortRows(
      (b.reservations || []).filter(function (r) {
        return r.area === 'OUTSIDE';
      }),
    );
    var waitingGuests = b.waiting && b.waiting.guests ? b.waiting.guests : 0;
    var logo =
      b.shop && b.shop.logoUrl
        ? '<img class="board-logo" src="' +
          escapeHtml(b.shop.logoUrl) +
          '" alt="" />'
        : '';

    root.innerHTML =
      '<div class="board" style="border-top: 3px solid ' +
      escapeHtml(accent) +
      '"><div class="board-inner">' +
      '<header class="board-hero">' +
      logo +
      '<p class="board-eyebrow" style="color:' +
      escapeHtml(accent) +
      '">Reservas de hoy</p>' +
      '<h1 class="board-brand">' +
      escapeHtml((b.shop && b.shop.name) || 'Local') +
      '</h1>' +
      '<p class="board-date">' +
      escapeHtml(formatDate(b.businessDate)) +
      '</p>' +
      '<div class="board-live-row">' +
      '<span class="board-live"><span class="board-pulse"></span>Auto · 30 s</span>' +
      '<button type="button" class="board-refresh" id="btn-refresh">Actualizar</button>' +
      '</div></header>' +
      (b.notice
        ? '<section class="board-notice"><p class="board-notice-label">Aviso</p><p class="board-notice-text">' +
          escapeHtml(b.notice) +
          '</p></section>'
        : '') +
      (waitingGuests > 0
        ? '<section class="board-waiting"><p class="board-waiting-label">Lista de espera</p><p class="board-waiting-count"><strong>' +
          escapeHtml(waitingGuests) +
          '</strong> ' +
          (waitingGuests === 1 ? 'persona' : 'personas') +
          '</p></section>'
        : '') +
      '<section class="board-totals">' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.guests) +
      '</strong><span>pers.</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.parties) +
      '</strong><span>mesas</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.inside) +
      '</strong><span>adentro</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.outside) +
      '</strong><span>afuera</span></div></div>' +
      '<div style="clear:both"></div></section>' +
      renderMix(b.reservations) +
      '<section class="board-lists">' +
      '<div class="board-col"><div class="board-col-inner"><h2>Adentro <span>' +
      inside.length +
      '</span></h2><ul id="list-in">' +
      renderList(inside, 'Sin reservas') +
      '</ul></div></div>' +
      '<div class="board-col board-col-out"><div class="board-col-inner"><h2>Afuera <span>' +
      outside.length +
      '</span></h2><ul id="list-out">' +
      renderList(outside, 'Sin reservas') +
      '</ul></div></div>' +
      '<div style="clear:both"></div></section>' +
      '</div></div>';

    var btn = $('btn-refresh');
    if (btn) {
      btn.onclick = function () {
        load(true);
      };
    }
    bindList($('list-in'));
    bindList($('list-out'));
  }

  function findRow(id) {
    if (!board || !board.reservations) return null;
    for (var i = 0; i < board.reservations.length; i++) {
      if (board.reservations[i].id === id) return board.reservations[i];
    }
    return null;
  }

  function patchStatus(id, status) {
    if (!board || !board.reservations) return;
    for (var i = 0; i < board.reservations.length; i++) {
      if (board.reservations[i].id === id) {
        board.reservations[i].status = status;
        board.reservations[i].removedAfterSeated = false;
        break;
      }
    }
  }

  function bindList(ul) {
    if (!ul) return;
    ul.onclick = function (ev) {
      var t = ev.target || ev.srcElement;
      while (t && t !== ul) {
        if (t.getAttribute && t.getAttribute('data-dismiss')) {
          dismissRow(t.getAttribute('data-dismiss'));
          if (ev.preventDefault) ev.preventDefault();
          if (ev.stopPropagation) ev.stopPropagation();
          return;
        }
        if (t.getAttribute && t.getAttribute('data-id')) {
          toggleSeat(t.getAttribute('data-id'));
          return;
        }
        t = t.parentNode;
      }
    };
  }

  function toggleSeat(id) {
    var r = findRow(id);
    if (!r || !canToggle(r) || busy) return;
    var prev = r.status;
    var next = prev === 'CONFIRMED' ? 'MARKED' : prev === 'MARKED' ? 'SEATED' : 'CONFIRMED';
    busy = true;
    patchStatus(id, next);
    render();
    xhr(
      'POST',
      API + '/public/shops/' + encodeURIComponent(slug) + '/reservations/' + encodeURIComponent(id) + '/seat',
      {},
      function (status, data) {
        busy = false;
        if (status >= 200 && status < 300 && data && data.status) {
          patchStatus(id, data.status);
        } else {
          patchStatus(id, prev);
          showToast('No se pudo marcar la mesa');
        }
        render();
      },
    );
  }

  function dismissRow(id) {
    var r = findRow(id);
    if (!r || !r.removedAfterSeated || busy) return;
    busy = true;
    var prevBoard = board;
    var kept = [];
    for (var i = 0; i < board.reservations.length; i++) {
      if (board.reservations[i].id !== id) kept.push(board.reservations[i]);
    }
    board.reservations = kept;
    render();
    xhr(
      'DELETE',
      API +
        '/public/shops/' +
        encodeURIComponent(slug) +
        '/reservations/' +
        encodeURIComponent(id) +
        '/dismiss',
      null,
      function (status) {
        busy = false;
        if (status >= 200 && status < 300) {
          showToast('Quitada: ' + ((r.guestName && r.guestName.replace(/^\s+|\s+$/g, '')) || 'Reserva'));
        } else {
          board = prevBoard;
          showToast('No se pudo quitar de la vista');
          render();
        }
      },
    );
  }

  function load(manual) {
    if (!slug) {
      render();
      return;
    }
    var btn = $('btn-refresh');
    if (btn && manual) btn.disabled = true;
    xhr(
      'GET',
      API + '/public/shops/' + encodeURIComponent(slug) + '/reservations',
      null,
      function (status, data) {
        if (btn) btn.disabled = false;
        if (status >= 200 && status < 300 && data) {
          board = data;
          if (data.shop && data.shop.name) {
            document.title = 'Reservas · ' + data.shop.name;
          }
          render();
        } else if (!board) {
          $('app').innerHTML =
            '<div class="board-error"><p>No se pudo cargar este local</p>' +
            '<button type="button" class="board-refresh" id="btn-retry">Reintentar</button></div>';
          var retry = $('btn-retry');
          if (retry) retry.onclick = function () { load(true); };
        } else if (manual) {
          showToast('No se pudo actualizar');
        }
      },
    );
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      load(false);
    }, 30000);
  }

  render();
  load(false);
  startPoll();
})();
