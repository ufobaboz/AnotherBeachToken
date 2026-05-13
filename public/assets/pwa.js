// Android Chrome: cattura beforeinstallprompt, chiama prompt() al click.
// iOS Safari: niente API, overlay con istruzioni "Condividi -> Aggiungi a Home".
// Standalone/appinstalled: il button si auto-nasconde.
(function () {
  if (typeof window === 'undefined') return;

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { }
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isIosSafari() {
    var ua = (window.navigator && window.navigator.userAgent) || '';
    var isIosDevice = /iPhone|iPad|iPod/.test(ua) || (ua.indexOf('Mac') !== -1 && 'ontouchend' in document);
    if (!isIosDevice) return false;
    // Esclude Chrome/Firefox/Edge/Opera su iOS: usano motori non-Safari.
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
    return true;
  }

  function strings() {
    var s = (window.Strings && window.Strings.pwa) || {};
    return {
      installLabel: s.installLabel || 'Installa app',
      iosTitle: s.iosTitle || 'Aggiungi a Home',
      iosStep1: s.iosStep1 || '1. Tocca il pulsante Condividi in basso (quadrato con freccia verso l\'alto).',
      iosStep2: s.iosStep2 || '2. Scorri il menu e scegli "Aggiungi alla schermata Home".',
      iosStep3: s.iosStep3 || '3. Conferma con "Aggiungi" in alto a destra.',
      iosClose: s.iosClose || 'Ho capito',
      genericTitle: s.genericTitle || 'Installa app',
      genericBody: s.genericBody || 'Il browser non ha proposto l\'installazione automatica. Apri il menu del browser e cerca la voce "Installa app" o "Aggiungi a schermata Home".'
    };
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) {
        console.warn('[pwa] sw register failed', e);
      });
    });
  }

  function makeInstallButton(label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost pwa-install-btn';
    btn.setAttribute('data-pwa-install', '1');
    btn.textContent = label;
    btn.style.display = 'none';
    return btn;
  }

  function mountButton(btn) {
    var navActions = document.querySelector('nav.app-nav .nav-actions');
    if (!navActions) return false;
    var logout = navActions.querySelector('button.btn--outline');
    if (logout) {
      navActions.insertBefore(btn, logout);
    } else {
      navActions.appendChild(btn);
    }
    return true;
  }

  function showOverlay(title, paragraphs, closeLabel) {
    if (document.querySelector('.pwa-install-overlay')) return;
    var overlay = document.createElement('div');
    overlay.className = 'pwa-install-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '9999', padding: '1rem'
    });
    var card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', padding: '1.25rem 1.25rem 1rem',
      maxWidth: '22rem', width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.25)'
    });
    var h = document.createElement('h2');
    h.textContent = title;
    h.style.margin = '0 0 0.75rem';
    h.style.fontSize = '1.1rem';
    card.appendChild(h);
    paragraphs.forEach(function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      p.style.margin = '0 0 0.5rem';
      card.appendChild(p);
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.textContent = closeLabel;
    close.style.width = '100%';
    close.style.marginTop = '0.5rem';
    close.addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    card.appendChild(close);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function showIosInstructions(t) {
    showOverlay(t.iosTitle, [t.iosStep1, t.iosStep2, t.iosStep3], t.iosClose);
  }

  function showGenericInstructions(t) {
    showOverlay(t.genericTitle, [t.genericBody], t.iosClose);
  }

  var deferredPrompt = null;
  var installedHandlers = [];

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    installedHandlers.forEach(function (h) { try { h(); } catch (_e) { } });
  });

  function triggerInstall() {
    var t = strings();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      var p = deferredPrompt.userChoice;
      if (p && typeof p.then === 'function') {
        p.then(function () { deferredPrompt = null; });
      } else {
        deferredPrompt = null;
      }
      return;
    }
    if (isIosSafari()) { showIosInstructions(t); return; }
    showGenericInstructions(t);
  }

  function bootInstallButton() {
    if (isStandalone()) return;
    var t = strings();
    var btn = makeInstallButton(t.installLabel);
    if (!mountButton(btn)) return;
    btn.style.display = '';
    btn.addEventListener('click', triggerInstall);
    installedHandlers.push(function () { btn.style.display = 'none'; });
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  registerServiceWorker();
  ready(bootInstallButton);

  window.PwaInstall = {
    isStandalone: isStandalone,
    isIosSafari: isIosSafari,
    triggerInstall: triggerInstall,
    installLabel: function () { return strings().installLabel; },
    onInstalled: function (fn) { if (typeof fn === 'function') installedHandlers.push(fn); }
  };
})();
