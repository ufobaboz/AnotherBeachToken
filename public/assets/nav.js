// Su viewport < 720px le voci .nav-actions sono nascoste via CSS e init()
// inietta sl-icon-button + sl-drawer con le stesse voci dentro sl-menu.

(function () {
  var NAV_ITEMS = [
    { key: 'customers',   path: '/customers',          minRole: 'operator'    },
    { key: 'scan',        path: '/scan',               minRole: 'operator'    },
    { key: 'users',       path: '/admin/users',        minRole: 'admin'       },
    { key: 'reports',     path: '/admin/reports',      minRole: 'admin'       },
    { key: 'resetSeason', path: '/admin/reset-season', minRole: 'super_admin' },
    { key: 'probe',       path: '/probe',              minRole: 'super_admin' },
    { key: 'profile',     path: '/me',                 minRole: 'operator'    }
  ];

  // Manuale fuori da NAV_ITEMS: x-for la renderizzerebbe prima dell'install
  // button iniettato da pwa.js. Iniettata a runtime dopo pwa.js.
  var MANUALE_KEY = 'manuale';
  var MANUALE_PATH = '/manuale';
  var MANUALE_MIN_ROLE = 'admin';

  var ROLE_RANK = { operator: 1, admin: 2, super_admin: 3 };

  var SL_ROOT = '/vendor/shoelace/2.20.1';
  var SL_BASE = SL_ROOT + '/components';
  var burgerComponentsPromise = null;
  var basePathPromise = null;

  function ensureBasePath() {
    // Shoelace di default scarica icone da shoelace.style/assets/icons:
    // self-hosted, rimappiamo a /vendor/shoelace/.../assets/icons.
    if (!basePathPromise) {
      basePathPromise = import(SL_ROOT + '/utilities/base-path.js')
        .then(function (mod) { mod.setBasePath(SL_ROOT); });
    }
    return basePathPromise;
  }

  function isCurrentPath(itemPath, currentPath) {
    if (currentPath === itemPath) return true;
    if (itemPath !== '/' && currentPath.indexOf(itemPath + '/') === 0) return true;
    return false;
  }

  function visibleItems(role, currentPath) {
    if (!role) return [];
    var userRank = ROLE_RANK[role] || 0;
    var t = (window.Strings && window.Strings.nav) || {};
    return NAV_ITEMS
      .filter(function (it) { return userRank >= ROLE_RANK[it.minRole]; })
      .map(function (it) {
        return {
          key: it.key,
          path: it.path,
          label: t[it.key] || it.key,
          isCurrent: isCurrentPath(it.path, currentPath)
        };
      });
  }

  function loadBurgerComponents() {
    if (!burgerComponentsPromise) {
      burgerComponentsPromise = Promise.all([
        import(SL_BASE + '/icon-button/icon-button.js'),
        import(SL_BASE + '/icon/icon.js'),
        import(SL_BASE + '/drawer/drawer.js'),
        import(SL_BASE + '/menu/menu.js'),
        import(SL_BASE + '/menu-item/menu-item.js'),
        import(SL_BASE + '/divider/divider.js')
      ]);
    }
    return burgerComponentsPromise;
  }

  function removeAllChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // pwa.js puo' iniettare l'install button prima o dopo alpine:init (ordine
  // indeterminato). Inseriamo Manuale prima del logout e usiamo un
  // MutationObserver per riordinare se install arriva dopo. Ordine finale
  // atteso: items, install, manuale, logout.
  function tryReorderAfterInstall(navActions, manuale) {
    var install = navActions.querySelector('[data-pwa-install]');
    if (!install) return false;
    if (install.nextSibling !== manuale) {
      navActions.insertBefore(manuale, install.nextSibling);
    }
    return true;
  }
  function injectManualeLink(navEl, role, label, currentPath) {
    if (!navEl) return;
    var userRank = ROLE_RANK[role] || 0;
    if (userRank < ROLE_RANK[MANUALE_MIN_ROLE]) return;
    var navActions = navEl.querySelector('.nav-actions');
    if (!navActions) return;
    if (navActions.querySelector('[data-manuale-link]')) return;
    var a = document.createElement('a');
    a.className = 'btn btn--ghost' + (currentPath === MANUALE_PATH ? ' btn--current' : '');
    a.setAttribute('href', MANUALE_PATH);
    a.setAttribute('data-manuale-link', '1');
    a.textContent = label;
    var logout = navActions.querySelector('button.btn--outline');
    if (logout) navActions.insertBefore(a, logout);
    else navActions.appendChild(a);
    if (!tryReorderAfterInstall(navActions, a)) {
      var obs = new MutationObserver(function () {
        if (tryReorderAfterInstall(navActions, a)) {
          obs.disconnect();
        }
      });
      obs.observe(navActions, { childList: true });
      setTimeout(function () { obs.disconnect(); }, 5000);
    }
  }

  function bindItemNavigation(mi, drawer, onSelect) {
    // Click sull'host sl-menu-item, NON sl-select su sl-menu: sl-menu.handleClick
    // filtra via composedPath con regole shadow-DOM che falliscono per nodi
    // creati programmaticamente (role applicato solo nel watcher Lit
    // waitUntilFirstUpdate:true).
    mi.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { drawer.hide(); } catch (_e) { /* no-op */ }
      onSelect();
    });
  }

  function buildDrawerContent(drawer, items, logoutLabel, onLogout, role, manualeLabel) {
    removeAllChildren(drawer);
    var menu = document.createElement('sl-menu');
    menu.className = 'nav-drawer-menu';
    items.forEach(function (it) {
      var mi = document.createElement('sl-menu-item');
      mi.setAttribute('value', it.path);
      if (it.isCurrent) mi.setAttribute('data-current', 'true');
      mi.textContent = it.label;
      bindItemNavigation(mi, drawer, function () { window.location.href = it.path; });
      menu.appendChild(mi);
    });
    if (items.length > 0) {
      menu.appendChild(document.createElement('sl-divider'));
    }
    if (window.PwaInstall && !window.PwaInstall.isStandalone()) {
      var installItem = document.createElement('sl-menu-item');
      installItem.setAttribute('value', '__install');
      installItem.setAttribute('data-pwa-install-drawer', '1');
      installItem.textContent = window.PwaInstall.installLabel();
      bindItemNavigation(installItem, drawer, function () { window.PwaInstall.triggerInstall(); });
      menu.appendChild(installItem);
      window.PwaInstall.onInstalled(function () {
        try { installItem.remove(); } catch (_e) { /* no-op */ }
      });
    }
    var userRank = ROLE_RANK[role] || 0;
    if (userRank >= ROLE_RANK[MANUALE_MIN_ROLE]) {
      var manualeItem = document.createElement('sl-menu-item');
      manualeItem.setAttribute('value', MANUALE_PATH);
      manualeItem.setAttribute('data-manuale-drawer', '1');
      manualeItem.textContent = manualeLabel || 'Manuale';
      bindItemNavigation(manualeItem, drawer, function () { window.location.href = MANUALE_PATH; });
      menu.appendChild(manualeItem);
    }
    var logoutItem = document.createElement('sl-menu-item');
    logoutItem.setAttribute('value', '__logout');
    logoutItem.textContent = logoutLabel;
    bindItemNavigation(logoutItem, drawer, function () { onLogout(); });
    menu.appendChild(logoutItem);
    drawer.appendChild(menu);
    return menu;
  }

  async function setupBurger(navEl, items, menuLabel, logoutLabel, role, manualeLabel) {
    if (!navEl) return;
    await Promise.all([ensureBasePath(), loadBurgerComponents()]);

    var burger = navEl.querySelector(':scope > .nav-burger');
    if (!burger) {
      burger = document.createElement('sl-icon-button');
      burger.className = 'nav-burger';
      burger.setAttribute('name', 'list');
      burger.setAttribute('label', menuLabel);
      navEl.insertBefore(burger, navEl.firstChild);
    }

    var drawer = navEl.querySelector(':scope > .nav-drawer');
    var isNew = false;
    if (!drawer) {
      drawer = document.createElement('sl-drawer');
      drawer.className = 'nav-drawer';
      drawer.setAttribute('placement', 'start');
      drawer.setAttribute('label', menuLabel);
      navEl.appendChild(drawer);
      isNew = true;
    }

    var onLogout = function () { window.Auth.signOut(); };
    buildDrawerContent(drawer, items, logoutLabel, onLogout, role, manualeLabel);

    if (isNew) {
      burger.addEventListener('click', function () {
        try { drawer.show(); } catch (e) { console.warn('[nav] drawer.show failed', e); }
      });
    }
  }

  document.addEventListener('alpine:init', function () {
    if (!window.Alpine) return;
    window.Alpine.data('appNav', function () {
      return {
        t: window.Strings,
        items: [],
        async init() {
          var role = null;
          try { role = await window.Auth.getRole(); }
          catch (e) { console.warn('[nav] getRole failed', e); }
          this.items = visibleItems(role, window.location.pathname);
          var menuLabel = (this.t && this.t.nav && this.t.nav.menu) || 'Menu';
          var logoutLabel = (this.t && this.t.logout) || 'Esci';
          var manualeLabel = (this.t && this.t.nav && this.t.nav.manuale) || 'Manuale';
          injectManualeLink(this.$el, role, manualeLabel, window.location.pathname);
          setupBurger(this.$el, this.items, menuLabel, logoutLabel, role, manualeLabel)
            .catch(function (err) { console.warn('[nav] burger setup failed', err); });
        },
        async logout() { await window.Auth.signOut(); }
      };
    });
  });

  window.AppNav = {
    visibleItems: visibleItems,
    NAV_ITEMS: NAV_ITEMS
  };
})();
