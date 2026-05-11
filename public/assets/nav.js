// repo/public/assets/nav.js
// Componente Alpine globale "appNav": topbar di navigazione condivisa.
// Dipende da window.Auth (getRole, signOut) e window.Strings (label nav).
//
// Uso nelle pagine:
//   <nav class="app-nav" x-data="appNav" x-init="init()">
//     <h1 x-text="t.<page>.title"></h1>
//     <div class="nav-actions">
//       <template x-for="item in items" :key="item.path">
//         <a class="btn btn--ghost" :class="item.isCurrent ? 'btn--current' : ''"
//            :href="item.path" x-text="item.label"></a>
//       </template>
//       <button class="btn btn--outline" @click="logout()" x-text="t.logout"></button>
//     </div>
//   </nav>
//
// La visibilita' per ruolo e' decisa qui via NAV_ITEMS sotto.
// Su viewport < 720px le voci .nav-actions vengono nascoste via CSS e
// init() inietta <sl-icon-button class="nav-burger"> + <sl-drawer class="nav-drawer">
// con le stesse voci dentro un <sl-menu>. Markup invariato nelle pagine.

(function () {
  // Path canonici delle pagine raggiungibili dalla nav.
  // Ogni voce dichiara il ruolo minimo richiesto:
  //   operator -> visibile a operator, admin, super_admin
  //   admin    -> visibile a admin, super_admin
  //   super_admin -> visibile solo a super_admin
  var NAV_ITEMS = [
    { key: 'customers', path: '/customers',    minRole: 'operator'    },
    { key: 'scan',      path: '/scan',         minRole: 'operator'    },
    { key: 'users',     path: '/admin/users',  minRole: 'admin'       },
    { key: 'season',    path: '/admin/season', minRole: 'super_admin' },
    { key: 'probe',     path: '/probe',        minRole: 'super_admin' },
    { key: 'profile',   path: '/me',           minRole: 'operator'    }
  ];

  var ROLE_RANK = { operator: 1, admin: 2, super_admin: 3 };

  var SL_ROOT = '/vendor/shoelace/2.20.1';
  var SL_BASE = SL_ROOT + '/components';
  var burgerComponentsPromise = null;
  var basePathPromise = null;

  function ensureBasePath() {
    // Default di shoelace: scarica le icone da https://shoelace.style/assets/icons/.
    // Siamo self-hosted: rimappiamo a /vendor/shoelace/.../assets/icons.
    if (!basePathPromise) {
      basePathPromise = import(SL_ROOT + '/utilities/base-path.js')
        .then(function (mod) { mod.setBasePath(SL_ROOT); });
    }
    return basePathPromise;
  }

  function isCurrentPath(itemPath, currentPath) {
    if (currentPath === itemPath) return true;
    // Sotto-pagine: /customers/* attive su /customers; /admin/users/* idem.
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

  function bindItemNavigation(mi, drawer, onSelect) {
    // Ascoltiamo direttamente il click sull'host sl-menu-item, NON sl-select
    // su sl-menu: sl-menu.handleClick filtra via composedPath con regole
    // shadow-DOM specifiche che falliscono con nodi creati programmaticamente
    // (es. role applicato solo nel watcher Lit waitUntilFirstUpdate:true).
    // Il click sull'host bubbla sempre e basta per la nostra UX.
    mi.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { drawer.hide(); } catch (_e) { /* no-op */ }
      onSelect();
    });
  }

  function buildDrawerContent(drawer, items, logoutLabel, onLogout) {
    // Wipe vecchio contenuto (in caso di re-init).
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
    var logoutItem = document.createElement('sl-menu-item');
    logoutItem.setAttribute('value', '__logout');
    logoutItem.textContent = logoutLabel;
    bindItemNavigation(logoutItem, drawer, function () { onLogout(); });
    menu.appendChild(logoutItem);
    drawer.appendChild(menu);
    return menu;
  }

  async function setupBurger(navEl, items, menuLabel, logoutLabel) {
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
    buildDrawerContent(drawer, items, logoutLabel, onLogout);

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
          setupBurger(this.$el, this.items, menuLabel, logoutLabel)
            .catch(function (err) { console.warn('[nav] burger setup failed', err); });
        },
        async logout() { await window.Auth.signOut(); }
      };
    });
  });

  // Esposto per test/debug. Non usato direttamente dalle pagine.
  window.AppNav = {
    visibleItems: visibleItems,
    NAV_ITEMS: NAV_ITEMS
  };
})();
