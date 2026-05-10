// repo/public/assets/strings.js
// Copy italiani per le pagine. ASCII puro: niente em-dash, ellissi,
// apostrofi tipografici. Le pagine consumano window.Strings.<section>.<key>.
window.Strings = {
  nav: {
    profile: 'Profilo'
  },
  app: {
    title: 'Customer QR Tracker'
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
    newButton: '+ Nuovo cliente',
    searchPlaceholder: 'Cerca per nome, cognome o telefono',
    columnName: 'Nome',
    columnPhone: 'Telefono',
    columnCreatedAt: 'Registrato il'
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
    sendQrWhatsApp: 'Invia QR su WhatsApp',
    qrWhatsAppText: function (firstName, publicUrl) {
      return 'Ciao ' + firstName + ', ecco il tuo QR per il bar: ' + publicUrl;
    },
    ctaCheckout: 'Chiudi conto',
    deleteButton: 'Cancella cliente',
    deleteDialogTitle: 'Conferma cancellazione',
    deleteDialogBody: function (firstName, lastName) {
      return 'Cancellare cliente ' + firstName + ' ' + lastName + '?'
           + ' L\'azione e\' reversibile solo via SQL editor da super_admin.';
    },
    deleteDialogConfirm: 'Cancella',
    deleteDialogCancel: 'Annulla',
    deleteError: 'Errore in fase di cancellazione. Riprova.',
    transactions: {
      empty: 'Nessun movimento registrato.',
      descCharge: function (amount) { return 'Addebito ' + amount + ' EUR'; },
      descReversal: function (amount) { return 'Storno addebito ' + amount + ' EUR'; },
      badgeAperto: 'APERTO',
      badgeStornato: 'STORNATO',
      badgeSaldato: 'SALDATO',
      paidInfoWithName: function (date, method, adminName) {
        return 'saldato il ' + date + ' via ' + method + ' da ' + adminName;
      },
      paidInfoNoName: function (date, method) {
        return 'saldato il ' + date + ' via ' + method;
      }
    },
    balance: {
      label: 'Saldo aperto',
      sendWhatsApp: 'Invia saldo su WhatsApp',
      whatsAppText: function (firstName, balanceFormatted, publicUrl) {
        return 'Ciao ' + firstName + ', il tuo saldo aperto e\' ' + balanceFormatted + ' EUR. Visualizzalo qui: ' + publicUrl;
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
    openBalanceLabel: 'Saldo aperto',
    currency: 'EUR'
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
    sectionMovements: 'Movimenti da saldare',
    emptyMovements: 'Nessun movimento da saldare.',
    balanceLabel: 'Saldo aperto',
    methodLabel: 'Metodo di pagamento',
    emptyBalanceCta: 'Nessun importo da saldare',
    confirmCta: function (amount, methodLabel) {
      return 'Conferma chiusura - ' + amount + ' EUR via ' + methodLabel;
    },
    submitting: 'Chiusura in corso...',
    error: 'Errore in fase di chiusura. Riprova.',
    partial: 'Chiusura parziale: ricarica la pagina e verifica.',
    raceAlert: function (n) {
      return 'Sono arrivate ' + n + ' nuove transazioni mentre eri qui. Apri di nuovo la chiusura per saldarle.';
    },
    raceReload: 'Ricarica chiusura'
  },
  adminUsers: {
    title: 'Gestione utenti',
    backToCustomers: 'Torna alla lista clienti',
    newOperatorButton: '+ Nuovo operator',
    newAdminButton: '+ Nuovo admin',
    showDeleted: 'Mostra cancellati',
    empty: 'Nessun utente registrato.',
    columnName: 'Nome',
    columnRole: 'Ruolo',
    columnLastLogin: 'Ultimo accesso',
    columnActions: 'Azioni',
    roleOperator: 'operator',
    roleAdmin: 'admin',
    roleSuperAdmin: 'super_admin',
    deletedBadge: function (date) {
      return 'CANCELLATO ' + date;
    },
    neverLogged: 'mai',
    editButton: 'Modifica',
    resetPwButton: 'Reset password',
    deleteButton: 'Cancella',
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
    deleteTitle: 'Conferma cancellazione',
    deleteBody: function (firstName, lastName, role) {
      return 'Cancellare ' + role + ' ' + firstName + ' ' + lastName + '? '
           + role + ' non potra\' piu\' loggarsi. Reversibile solo via SQL editor da super_admin.';
    },
    deleteConfirm: 'Cancella',
    deleteError: 'Errore in fase di cancellazione. Riprova.',
    deleteForbiddenTarget: 'Solo super_admin puo\' cancellare un admin.',
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
  probe: {
    title: 'Probe diagnostico',
    statusOk: 'OK',
    statusFail: 'FAIL',
    statusNa: 'n/a',
    refreshHint: 'Ricarica la pagina per ri-eseguire i check.',
    openBalanceLabel: 'Saldo aperto totale'
  }
};
