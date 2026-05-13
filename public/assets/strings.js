// ASCII puro: niente em-dash, ellissi, apostrofi tipografici.
window.Strings = {
  nav: {
    customers: 'Clienti',
    scan: 'Scan',
    users: 'Utenti',
    reports: 'Report',
    manuale: 'Manuale',
    resetSeason: 'Reset stagione',
    probe: 'Probe',
    profile: 'Profilo',
    menu: 'Menu'
  },
  app: {
    title: 'Another Beach Token'
  },
  login: {
    title: 'Accedi',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    submit: 'Entra',
    submitting: 'Accesso in corso...'
  },
  errors: {
    invalid_credentials: 'Email o password non corretti, riprova.',
    network: 'Errore di rete, riprova fra qualche secondo.',
    unknown: 'Si e\' verificato un errore. Riprova.'
  },
  customers: {
    title: 'Clienti',
    empty: 'Nessun cliente registrato. Clicca "Nuovo cliente" per iniziare.',
    emptySearch: 'Nessun cliente corrisponde alla ricerca.',
    emptyOpen: 'Nessun cliente con conto aperto. Clicca "Mostra tutti" per vedere l\'intero elenco.',
    newButton: '+ Nuovo cliente',
    searchPlaceholder: 'Cerca nome o numero',
    showAll: 'Mostra tutti',
    showOpen: 'Solo conti aperti',
    columnName: 'Nome',
    columnBalance: 'Conto',
    columnPhone: 'Telefono',
    columnCreatedAt: 'Registrato il',
    pagePrev: 'Precedente',
    pageNext: 'Successiva',
    pageInfo: function (page, total) { return 'Pagina ' + page + ' di ' + total; }
  },
  customerNew: {
    title: 'Nuovo cliente',
    backToList: 'Torna alla lista',
    firstName: 'Nome',
    lastName: 'Cognome',
    phone: 'Telefono',
    phonePlaceholder: '+39 333 1234567',
    email: 'Email (opzionale)',
    notes: 'Note (opzionale)',
    submit: 'Registra',
    submitting: 'Registrazione in corso...',
    invalidPhone: 'Telefono non valido. Inserire in formato internazionale (es. +39 333 1234567).',
    error: 'Errore in fase di registrazione. Riprova.'
  },
  customerDetail: {
    title: 'Dettaglio cliente',
    backToList: 'Torna alla lista',
    notFound: 'Cliente non trovato.',
    sectionAnagrafica: 'Anagrafica',
    sectionTransactions: 'Movimenti',
    createdAt: 'Registrato il',
    qrAlt: 'QR code del cliente',
    downloadQr: 'Scarica QR',
    sendWhatsApp: 'Invia su WhatsApp',
    ctaCheckout: 'Chiudi conto',
    deleteButton: 'Archivia cliente',
    deleteDialogTitle: 'Conferma archiviazione',
    deleteDialogBody: function (firstName, lastName) {
      return 'Archiviare ' + firstName + ' ' + lastName + '?';
    },
    deleteDialogConfirm: 'Archivia',
    deleteDialogCancel: 'Annulla',
    deleteError: 'Errore in fase di archiviazione. Riprova.',
    transactions: {
      empty: 'Nessun movimento registrato.',
      descCharge: function (amount) { return 'Addebito ' + amount + ' EUR'; },
      descReversal: function (amount) { return 'Storno addebito ' + amount + ' EUR'; },
      badgeAperto: 'APERTO',
      badgeAnnullato: 'ANNULLATO',
      badgeSaldato: 'SALDATO',
      annulledInfo: function (date) { return 'annullato il ' + date; },
      paidInfoWithName: function (date, method, adminName) {
        return 'saldato il ' + date + ' via ' + method + ' da ' + adminName;
      },
      paidInfoNoName: function (date, method) {
        return 'saldato il ' + date + ' via ' + method;
      }
    },
    balance: {
      label: 'Conto aperto',
      refresh: 'Aggiorna',
      whatsAppText: function (firstName, balanceFormatted, publicUrl) {
        return 'Ciao ' + firstName + ', il tuo conto aperto e\' ' + balanceFormatted + ' EUR. Visualizzalo qui: ' + publicUrl;
      }
    },
    charge: {
      ctaNew: '+ Nuovo addebito',
      submit: 'ADDEBITA',
      submitting: 'Addebito in corso...',
      cancel: 'Vedi storia',
      backspaceLabel: 'Cancella ultima cifra',
      error: 'Errore in fase di addebito. Riprova.'
    },
    reversal: {
      button: 'Storna',
      dialogTitle: 'Confermare storno',
      dialogBody: function (amount, time) {
        return 'Storno di ' + amount + ' EUR dell\'addebito delle ' + time + '? Questa azione non e\' reversibile.';
      },
      cancel: 'Annulla',
      confirm: 'Conferma storno',
      error: 'Errore in fase di storno. Riprova.'
    }
  },
  qrPublic: {
    greeting: function (firstName) { return 'Ciao ' + firstName; },
    notFound: 'QR non trovato.',
    qrAlt: 'Il tuo QR code',
    openBalanceLabel: 'Conto aperto',
    currency: 'EUR',
    refresh: 'Aggiorna'
  },
  paymentMethods: {
    cash: 'Contanti',
    card: 'Carta',
    transfer: 'Bonifico',
    other: 'Altro'
  },
  checkout: {
    title: 'Chiusura conto',
    backToList: 'Torna alla lista',
    notFound: 'Cliente non trovato.',
    sectionMovements: 'Movimenti da pagare',
    emptyMovements: 'Nessun movimento da pagare.',
    balanceLabel: 'Conto aperto',
    methodLabel: 'Metodo di pagamento',
    emptyBalanceCta: 'Nessun importo da pagare',
    confirmAndArchiveCta: 'Chiudi conto e archivia',
    confirmPartialCta: 'Chiusura parziale',
    submitting: 'Chiusura in corso...',
    submittingArchive: 'Chiusura e archiviazione in corso...',
    error: 'Errore in fase di chiusura. Riprova.',
    archiveError: 'Conto chiuso, ma errore in fase di archiviazione cliente.',
    partial: 'Chiusura parziale: ricarica la pagina e verifica.',
    raceAlert: function (n) {
      return 'Sono arrivate ' + n + ' nuove transazioni mentre eri qui. Apri di nuovo la chiusura per saldarle.';
    },
    raceReload: 'Ricarica chiusura'
  },
  adminUsers: {
    title: 'Gestione utenti',
    backToCustomers: 'Torna alla lista clienti',
    newOperatorButton: '+ Nuovo operatore',
    newAdminButton: '+ Nuovo admin',
    showAll: 'Mostra tutti',
    showActiveOnly: 'Solo attivi',
    empty: 'Nessun utente registrato.',
    columnName: 'Nome',
    columnRole: 'Ruolo',
    columnLastLogin: 'Ultimo accesso',
    columnActions: 'Azioni',
    roleOperator: 'operator',
    roleAdmin: 'admin',
    roleSuperAdmin: 'super_admin',
    deletedBadge: function (date) {
      return 'DISATTIVATO ' + date;
    },
    neverLogged: 'mai',
    editButton: 'Modifica',
    resetPwButton: 'Reset pw',
    deleteButton: 'Disattiva',
    changeRoleButton: 'Cambia ruolo',
    cancel: 'Annulla',
    email: 'Email',
    password: 'Password iniziale',
    passwordHint: 'Almeno 8 caratteri.',
    newPassword: 'Nuova password',
    confirmPassword: 'Conferma password',
    passwordMismatch: 'Le password non coincidono.',
    firstName: 'Nome',
    lastName: 'Cognome',
    notes: 'Note (opzionale)',
    createTitle: function (role) {
      return 'Nuovo ' + role;
    },
    createSubmit: 'Crea',
    createSubmitting: 'Creazione in corso...',
    createSuccess: function (role) {
      return role.charAt(0).toUpperCase() + role.slice(1) + ' creato. Comunica la password via canale fuori app.';
    },
    createErrorEmail: 'Email gia\' registrata.',
    createErrorWeakPassword: 'Password troppo debole. Usa almeno 8 caratteri.',
    createErrorForbidden: 'Solo super_admin puo\' creare admin.',
    createError: 'Errore in fase di creazione. Riprova.',
    editTitle: function (role) {
      return 'Modifica ' + role;
    },
    editSubmit: 'Salva',
    editSubmitting: 'Salvataggio in corso...',
    editError: 'Errore in fase di modifica. Riprova.',
    editForbiddenTarget: 'Solo super_admin puo\' modificare un admin.',
    resetPwTitle: 'Reset password',
    resetPwBody: function (firstName, lastName, role) {
      return 'Imposta una nuova password per ' + firstName + ' ' + lastName
           + ' (' + role + '). Comunicagliela via canale fuori app.';
    },
    resetPwSubmit: 'Reset',
    resetPwSubmitting: 'Reset in corso...',
    resetPwSuccess: 'Password aggiornata. Comunicala via canale fuori app.',
    resetPwError: 'Errore in fase di reset. Riprova.',
    resetPwForbiddenTarget: 'Solo super_admin puo\' resettare la password di un admin.',
    deleteTitle: 'Conferma disattivazione',
    deleteBody: function (firstName, lastName, role) {
      return 'Disattivare ' + role + ' ' + firstName + ' ' + lastName + '? '
           + role + ' non potra\' piu\' loggarsi. Reversibile solo via SQL editor da super_admin.';
    },
    deleteConfirm: 'Disattiva',
    deleteError: 'Errore in fase di disattivazione. Riprova.',
    deleteForbiddenTarget: 'Solo super_admin puo\' disattivare un admin.',
    changeRoleTitle: 'Cambia ruolo',
    changeRoleBody: function (firstName, lastName, fromRole, toRole) {
      if (toRole === 'admin') {
        return 'Promuovere ' + firstName + ' ' + lastName
             + ' a admin? Potra\' chiudere conti e gestire operator.'
             + ' Dovra\' rilogga per applicare il nuovo ruolo.';
      }
      return 'Retrocedere ' + firstName + ' ' + lastName
           + ' a operator? Perdera\' accesso a /checkout e /admin/users.'
           + ' Dovra\' rilogga per applicare il nuovo ruolo.';
    },
    changeRoleSubmit: 'Conferma',
    changeRoleSubmitting: 'Aggiornamento in corso...',
    changeRoleSuccess: function (firstName, lastName, newRole) {
      return firstName + ' ' + lastName + ' e\' ora ' + newRole
           + '. Dovra\' rilogga per applicare il nuovo ruolo.';
    },
    changeRoleError: 'Errore in fase di cambio ruolo. Riprova.'
  },
  scan: {
    title: 'Scansiona QR',
    cameraDenied: 'Permesso camera negato. Concedi accesso alla telecamera per scansionare.',
    invalidQr: 'QR non valido. Inquadra un QR cliente.',
    notFound: 'QR non riconosciuto. Cliente inesistente o cancellato.',
    backToList: 'Torna alla lista'
  },
  me: {
    title: 'Profilo',
    back: 'Torna indietro',
    loadError: 'Errore in fase di caricamento del profilo. Ricarica la pagina.',
    fields: {
      role: 'Ruolo',
      email: 'Email',
      lastLogin: 'Ultimo accesso',
      notes: 'Note',
      neverLogged: 'mai'
    },
    changePasswordButton: 'Cambia password',
    changePasswordTitle: 'Cambia password',
    oldPassword: 'Vecchia password',
    newPassword: 'Nuova password',
    confirmPassword: 'Conferma nuova password',
    passwordMismatch: 'Le password non coincidono.',
    passwordHint: 'Almeno 8 caratteri.',
    changePasswordSubmit: 'Cambia password',
    changePasswordSubmitting: 'Aggiornamento in corso...',
    changePasswordCancel: 'Annulla',
    changePasswordSuccess: 'Password aggiornata.',
    changePasswordInvalidOld: 'Vecchia password sbagliata.',
    changePasswordWeak: 'Nuova password troppo debole. Usa almeno 8 caratteri.',
    changePasswordError: 'Errore in fase di cambio password. Riprova.'
  },
  logout: 'Esci',
  adminReports: {
    title: 'Report',
    backToCustomers: 'Torna alla lista clienti',
    intro: 'Scarica i due report della stagione corrente in CSV.',
    exportsTitle: 'Esportazioni',
    exportsHint: 'Tutte le righe (incluse cancellate). Date in fuso Europe/Rome.',
    exportAggregate: 'Esporta aggregato per cliente',
    downloadingAggregate: 'Esportazione aggregato...',
    exportDetails: 'Esporta dettaglio transazioni',
    downloadingDetails: 'Esportazione dettaglio...',
    downloadError: 'Errore durante l\'esportazione. Vedi console per i dettagli.',
    rowsCount: function (n) { return n + ' righe'; },
    aggregateColumns: [
      'Cliente', 'Email', 'Telefono', 'Note cliente',
      'Data registrazione', 'Data cancellazione cliente',
      'Numero transazioni', 'Numero addebiti', 'Numero storni',
      'Totale addebiti (EUR)', 'Totale storni (EUR)',
      'Saldo aperto (EUR)', 'Totale pagato (EUR)',
      'Ultima transazione'
    ],
    aggregateColumnKeys: [
      'cliente', 'email', 'telefono', 'note_cliente',
      'data_registrazione', 'data_cancellazione_cliente',
      'numero_transazioni', 'numero_addebiti', 'numero_storni',
      'totale_addebiti_eur', 'totale_storni_eur',
      'saldo_aperto_eur', 'totale_pagato_eur',
      'ultima_transazione'
    ],
    detailColumns: [
      'Tipo', 'Importo (EUR)', 'Note',
      'Data registrazione', 'Data cancellazione',
      'Operatore', 'Pagato', 'Data pagamento', 'Metodo pagamento',
      'Incassato da', 'Cliente', 'Telefono cliente'
    ],
    detailColumnKeys: [
      'tipo', 'importo_eur', 'note',
      'data_registrazione', 'data_cancellazione',
      'operatore', 'pagato', 'data_pagamento', 'metodo_pagamento',
      'incassato_da', 'cliente', 'telefono_cliente'
    ]
  },
  adminResetSeason: {
    title: 'Reset stagione',
    backToCustomers: 'Torna alla lista clienti',
    intro: 'Cancella DEFINITIVAMENTE tutti i clienti e tutte le transazioni. I profili (operatori) restano intatti. Scarica gli archivi prima di procedere.',
    resetButton: 'Reset stagione',
    resetDialogTitle: 'Reset stagione',
    resetDialogBody: 'Cancellazione irreversibile.',
    resetConfirmHint: 'Per confermare digita esattamente:',
    resetConfirmString: 'RESET STAGIONE',
    resetConfirmPlaceholder: 'RESET STAGIONE',
    cancel: 'Annulla',
    confirmReset: 'Conferma reset',
    resetting: 'Reset in corso...',
    resetSuccess: 'Stagione resettata. Customers e transactions sono ora vuote.',
    resetError: 'Errore durante il reset. Vedi console per i dettagli.'
  },
  probe: {
    title: 'Probe diagnostico',
    statusOk: 'OK',
    statusFail: 'FAIL',
    statusNa: 'n/a',
    refreshHint: 'Ricarica la pagina per ri-eseguire i check.',
    openBalanceLabel: 'Conto aperto totale',
    backupTitle: 'Backup giornaliero R2',
    backupNotConfigured: 'Daily backup non applicabile in questo ambiente (PRD only)',
    backupNone: 'Nessun backup trovato in daily/',
    backupIncomplete: function (date, found, expected) {
      return 'Backup ' + date + ' incompleto: ' + found + '/' + expected + ' file';
    },
    backupStale: function (ageH, date) {
      return 'Ultimo backup ' + ageH + 'h fa (' + date + ')';
    },
    backupOk: function (date, ageH, found, expected) {
      return date + ' (' + ageH + 'h fa, ' + found + '/' + expected + ' file)';
    }
  },
  pwa: {
    installLabel: 'Installa app',
    iosTitle: 'Aggiungi Another Beach Token a Home',
    iosStep1: '1. Tocca il pulsante Condividi in basso (quadrato con freccia verso l\'alto).',
    iosStep2: '2. Scorri il menu e scegli "Aggiungi alla schermata Home".',
    iosStep3: '3. Conferma con "Aggiungi" in alto a destra.',
    iosClose: 'Ho capito',
    genericTitle: 'Installa Another Beach Token',
    genericBody: 'Il browser non ha proposto l\'installazione automatica. Apri il menu del browser e cerca la voce "Installa app" o "Aggiungi a schermata Home". Su desktop Chrome l\'icona di installazione compare nella barra degli indirizzi.'
  }
};
