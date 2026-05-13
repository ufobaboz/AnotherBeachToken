// 32 char base32 A-Z 2-7 = 160 bit di entropia. UNIQUE constraint DB
// protegge da collisioni teoriche.
(function () {
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  window.generateQrToken = function () {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < 32; i++) {
      out += ALPHABET[bytes[i] & 0x1f];
    }
    return out;
  };
})();
