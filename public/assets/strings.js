// repo/public/assets/strings.js
// Copy italiani per le pagine. ASCII puro: niente em-dash, ellissi,
// apostrofi tipografici. Le pagine consumano window.Strings.<section>.<key>.
window.Strings = {
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
    transactionsStub: 'Sezione movimenti attiva da M4.',
    createdAt: 'Registrato il',
    qrAlt: 'QR code del cliente',
    downloadQr: 'Scarica QR',
    sendQrWhatsApp: 'Invia QR su WhatsApp',
    qrWhatsAppText: function (firstName, publicUrl) {
      return 'Ciao ' + firstName + ', ecco il tuo QR per il bar: ' + publicUrl;
    },
    deleteButton: 'Cancella cliente',
    deleteDialogTitle: 'Conferma cancellazione',
    deleteDialogBody: function (firstName, lastName) {
      return 'Cancellare cliente ' + firstName + ' ' + lastName + '?'
           + ' L\'azione e\' reversibile solo via SQL editor da super_admin.';
    },
    deleteDialogConfirm: 'Cancella',
    deleteDialogCancel: 'Annulla',
    deleteError: 'Errore in fase di cancellazione. Riprova.'
  },
  qrPublic: {
    greeting: function (firstName) { return 'Ciao ' + firstName; },
    notFound: 'QR non trovato.',
    qrAlt: 'Il tuo QR code',
    openBalanceLabel: 'Saldo aperto',
    currency: 'EUR'
  },
  logout: 'Esci',
  probe: {
    title: 'Probe diagnostico',
    statusOk: 'OK',
    statusFail: 'FAIL',
    statusNa: 'n/a',
    refreshHint: 'Ricarica la pagina per ri-eseguire i check.'
  }
};
