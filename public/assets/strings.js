// repo/public/assets/strings.js
// Copy italiani per le pagine M2. ASCII puro: niente em-dash, ellissi,
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
    empty: 'Lista clienti vuota.'
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
