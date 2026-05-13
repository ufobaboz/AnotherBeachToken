// Dual-purpose (browser window.Csv + Node ESM/CJS export): single source of
// truth della serializzazione CSV ITA-friendly. Separator ';', RFC 4180
// quoting, anti-formula-injection (CWE-1236) e date in Europe/Rome.
// Il caller wrappa in Blob con BOM UTF-8 per compatibilita' Excel.
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

  // CWE-1236: campi che iniziano con =, +, -, @, TAB, CR sono interpretati
  // come formula. L'apostrofo iniziale e' rimosso visivamente dal parser ma
  // sopprime la valutazione. Applicato PRIMA del quoting RFC 4180.
  var FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
  function neutralizeFormula(str) {
    if (FORMULA_PREFIX_RE.test(str)) return "'" + str;
    return str;
  }

  function escape(str) {
    if (str === '') return '';
    str = neutralizeFormula(str);
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

  var Csv = { serialize: serialize, formatCell: formatCell };
  if (typeof window !== 'undefined') window.Csv = Csv;
  if (typeof module !== 'undefined' && module.exports) module.exports = Csv;
})();
