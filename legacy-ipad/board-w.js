/* Tablero público lista de espera — ES5 para iPad antiguo */
(function () {
  'use strict';

  var cfg = window.CRC_LEGACY_CONFIG || {};
  var API = cfg.apiUrl || '/api/v1';
  var slug = resolveSlug();
  var board = null;
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
    var m = path.match(/\/ipad\/w\/([^\/]+)\/?$/);
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

  function xhr(method, url, cb) {
    var req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Accept', 'application/json');
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
    req.send(null);
  }

  function renderItem(w) {
    return (
      '<li>' +
      '<span class="board-name">' +
      (w.position != null ? '<span class="board-num">#' + escapeHtml(w.position) + '</span> ' : '') +
      escapeHtml(w.guestName || 'Invitado') +
      '</span>' +
      '<span class="board-meta"><span class="board-pax"><strong>' +
      escapeHtml(w.partySize) +
      '</strong><span>p</span></span></span></li>'
    );
  }

  function renderList(rows) {
    if (!rows.length) return '<li class="board-empty">Sin espera</li>';
    var html = '';
    for (var i = 0; i < rows.length; i++) html += renderItem(rows[i]);
    return html;
  }

  function render() {
    var root = $('app');
    if (!root) return;

    if (!slug) {
      root.innerHTML = '<div class="board-error"><p>Local no encontrado</p></div>';
      return;
    }
    if (!board) {
      root.innerHTML = '<div class="board-loading">Cargando lista de espera…</div>';
      return;
    }

    var b = board;
    var accent = (b.shop && b.shop.accentColor) || '#c45c26';
    var inside = (b.waiting || []).filter(function (w) {
      return w.area !== 'OUTSIDE';
    });
    var outside = (b.waiting || []).filter(function (w) {
      return w.area === 'OUTSIDE';
    });
    var logo =
      b.shop && b.shop.logoUrl
        ? '<img class="board-logo" src="' + escapeHtml(b.shop.logoUrl) + '" alt="" />'
        : '';

    root.innerHTML =
      '<div class="board" style="border-top: 3px solid ' +
      escapeHtml(accent) +
      '"><div class="board-inner">' +
      '<header class="board-hero">' +
      logo +
      '<p class="board-eyebrow" style="color:' +
      escapeHtml(accent) +
      '">Lista de espera</p>' +
      '<h1 class="board-brand">' +
      escapeHtml((b.shop && b.shop.name) || 'Local') +
      '</h1>' +
      '<div class="board-live-row">' +
      '<span class="board-live"><span class="board-pulse"></span>Auto · 1 min</span>' +
      '<button type="button" class="board-refresh" id="btn-refresh">Actualizar</button>' +
      '</div></header>' +
      '<section class="board-totals">' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.guests) +
      '</strong><span>pers.</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.parties) +
      '</strong><span>grupos</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.inside) +
      '</strong><span>adentro</span></div></div>' +
      '<div class="board-total"><div class="board-total-inner"><strong>' +
      escapeHtml(b.totals.outside) +
      '</strong><span>afuera</span></div></div>' +
      '<div style="clear:both"></div></section>' +
      '<section class="board-lists">' +
      '<div class="board-col"><div class="board-col-inner"><h2>Adentro <span>' +
      inside.length +
      '</span></h2><ul>' +
      renderList(inside) +
      '</ul></div></div>' +
      '<div class="board-col board-col-out"><div class="board-col-inner"><h2>Afuera <span>' +
      outside.length +
      '</span></h2><ul>' +
      renderList(outside) +
      '</ul></div></div>' +
      '<div style="clear:both"></div></section>' +
      '</div></div>';

    var btn = $('btn-refresh');
    if (btn) btn.onclick = function () { load(true); };
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
      API + '/public/shops/' + encodeURIComponent(slug) + '/waiting-list',
      function (status, data) {
        if (btn) btn.disabled = false;
        if (status >= 200 && status < 300 && data) {
          board = data;
          if (data.shop && data.shop.name) {
            document.title = 'Espera · ' + data.shop.name;
          }
          render();
        } else if (!board) {
          $('app').innerHTML =
            '<div class="board-error"><p>No se pudo cargar este local</p>' +
            '<button type="button" class="board-refresh" id="btn-retry">Reintentar</button></div>';
          var retry = $('btn-retry');
          if (retry) retry.onclick = function () { load(true); };
        }
      },
    );
  }

  render();
  load(false);
  pollTimer = setInterval(function () {
    load(false);
  }, 60000);
})();
