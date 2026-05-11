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
