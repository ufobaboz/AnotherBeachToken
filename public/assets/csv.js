// repo/public/assets/csv.js
// Helper di serializzazione CSV ITA-friendly per /admin/season.
// Espone window.Csv.serialize(rows, columns) -> string.
//
// Convenzioni (M8 Sub-A):
// - Separator ';' (Excel ITA su Windows con locale it-IT lo legge senza wizard).
// - Quoting RFC 4180: campi con ';', '"', '\n', '\r' wrap in '"..."',
//   '"' escape -> '""'.
// - NULL/undefined -> stringa vuota.
// - Boolean -> 'true'/'false'.
// - Numero -> stringa numerica con punto decimale.
// - ISO timestamptz -> 'dd/MM/yyyy HH:mm' in fuso Europe/Rome
//   via Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', ... }).
// - Header: nome colonna come da DB (inglese), come passati nel parametro
//   columns.
//
// Il caller wrappa l'output in un Blob con BOM UTF-8 per compatibilita'
// Excel (vedi /admin/season.html download handler).
(function () {
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  var dateFormatter = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      var parts = dateFormatter.formatToParts(d);
      var dd, mm, yyyy, hh, mi;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.type === 'day') dd = p.value;
        else if (p.type === 'month') mm = p.value;
        else if (p.type === 'year') yyyy = p.value;
        else if (p.type === 'hour') hh = p.value;
        else if (p.type === 'minute') mi = p.value;
      }
      return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi;
    } catch (e) {
      return iso;
    }
  }

  function formatCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
      if (ISO_RE.test(value)) return formatDate(value);
      return value;
    }
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function escape(str) {
    if (str === '') return '';
    if (/[;"\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function serialize(rows, columns) {
    if (!Array.isArray(rows)) rows = [];
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error('Csv.serialize: columns must be a non-empty array');
    }
    var lines = [];
    var headerCells = [];
    for (var c = 0; c < columns.length; c++) headerCells.push(escape(columns[c]));
    lines.push(headerCells.join(';'));
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var fields = [];
      for (var k = 0; k < columns.length; k++) {
        fields.push(escape(formatCell(row[columns[k]])));
      }
      lines.push(fields.join(';'));
    }
    return lines.join('\r\n');
  }

  window.Csv = { serialize: serialize, formatCell: formatCell };
})();
