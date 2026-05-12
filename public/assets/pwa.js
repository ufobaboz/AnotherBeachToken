// repo/public/assets/pwa.js
// Bootstrap PWA per ogni pagina operatore:
//   1) registra il service worker (criterio installabilita' Chrome);
//   2) inietta un pulsante "Installa app" nella topbar (o nel main se la nav
//      non esiste, come su /login), gestendo entrambi i flussi:
//         - Android Chrome: cattura beforeinstallprompt, chiama prompt() al click.
//         - iOS Safari: niente API, apre un overlay con istruzioni "Condividi -> Aggiungi a Home".
//   3) si nasconde da solo se l'app gira gia' in modalita' standalone o dopo appinstalled.
//
// Niente dipendenze: solo DOM puro + window.Strings. Nessuna modifica al markup
// delle pagine: il pulsante e' iniettato a runtime in nav.app-nav .nav-actions
// (prima del bottone Esci) oppure, come fallback, dentro main.container.

(function () {
  if (typeof window === 'undefined') return;

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* no-op */ }
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isIosSafari() {
    var ua = (window.navigator && window.navigator.userAgent) || '';
    var isIosDevice = /iPhone|iPad|iPod/.test(ua) || (ua.indexOf('Mac') !== -1 && 'ontouchend' in document);
    if (!isIosDevice) return false;
    // Escludi browser non-Safari su iOS (CriOS = Chrome iOS, FxiOS = Firefox iOS, EdgiOS = Edge iOS).
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
      iosClose: s.iosClose || 'Ho capito'
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
    if (navActions) {
      // Inserisci prima del pulsante Esci, se presente; altrimenti come ultimo figlio.
      var logout = navActions.querySelector('button.btn--outline');
      if (logout) {
        navActions.insertBefore(btn, logout);
      } else {
        navActions.appendChild(btn);
      }
      return true;
    }
    var main = document.querySelector('main.container');
    if (main) {
      btn.classList.remove('btn--ghost');
      btn.classList.add('btn--outline', 'pwa-install-btn--standalone');
      btn.style.marginTop = '1rem';
      main.appendChild(btn);
      return true;
    }
    return false;
  }

  function showIosInstructions(t) {
    if (document.querySelector('.pwa-ios-overlay')) return;
    var overlay = document.createElement('div');
    overlay.className = 'pwa-ios-overlay';
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
    h.textContent = t.iosTitle;
    h.style.margin = '0 0 0.75rem';
    h.style.fontSize = '1.1rem';
    var p1 = document.createElement('p'); p1.textContent = t.iosStep1; p1.style.margin = '0 0 0.5rem';
    var p2 = document.createElement('p'); p2.textContent = t.iosStep2; p2.style.margin = '0 0 0.5rem';
    var p3 = document.createElement('p'); p3.textContent = t.iosStep3; p3.style.margin = '0 0 0.75rem';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.textContent = t.iosClose;
    close.style.width = '100%';
    close.addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    card.appendChild(h);
    card.appendChild(p1);
    card.appendChild(p2);
    card.appendChild(p3);
    card.appendChild(close);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function bootInstallButton() {
    if (isStandalone()) return; // gia' installata
    var t = strings();
    var btn = makeInstallButton(t.installLabel);
    if (!mountButton(btn)) return;

    var deferred = null;
    var iosMode = isIosSafari();

    if (iosMode) {
      btn.style.display = '';
      btn.addEventListener('click', function () { showIosInstructions(t); });
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      btn.style.display = '';
    });

    if (!iosMode) {
      btn.addEventListener('click', function () {
        if (!deferred) return;
        deferred.prompt();
        if (deferred.userChoice && typeof deferred.userChoice.then === 'function') {
          deferred.userChoice.then(function () {
            deferred = null;
            btn.style.display = 'none';
          });
        } else {
          deferred = null;
          btn.style.display = 'none';
        }
      });
    }

    window.addEventListener('appinstalled', function () {
      btn.style.display = 'none';
    });
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

  // Esposto per test/debug.
  window.PwaInstall = {
    isStandalone: isStandalone,
    isIosSafari: isIosSafari
  };
})();
