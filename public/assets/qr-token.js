// repo/public/assets/qr-token.js
// Genera un qr_token da 32 caratteri base32 (alfabeto A-Z 2-7).
// 160 bit di entropia (32 byte * 5 bit usati per byte).
// UNIQUE constraint a livello DB protegge da collisioni teoriche
// (probabilita' su 1000 customers ~ 0).
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
