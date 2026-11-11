(function () {
  var digits = {}, alphabet = ALPHABET, i;
  for (i = 0; i < 91; i++) digits[alphabet.charCodeAt(i)] = i;

  function bytes(text) {
    var out = new Uint8Array(text.length), n = 0, value = -1, acc = 0, bits = 0, digit, j;
    for (j = 0; j < text.length; j++) {
      digit = digits[text.charCodeAt(j)];
      if (value < 0) value = digit;
      else {
        value += digit * 91;
        acc |= value << bits;
        bits += (value & 8191) > 88 ? 13 : 14;
        do { out[n++] = acc & 255; acc >>= 8; bits -= 8; } while (bits > 7);
        value = -1;
      }
    }
    if (value > -1) out[n++] = (acc | value << bits) & 255;
    return out.subarray(0, n);
  }

  function inflate(src, total) {
    var out = new Uint8Array(total), ip = 0, op = 0, buf = 0, have = 0;
    function bits(n) {
      while (have < n) { buf |= src[ip++] << have; have += 8; }
      var r = buf & ((1 << n) - 1);
      buf >>>= n; have -= n;
      return r;
    }
    function table(lens, n) {
      var counts = new Uint16Array(16), symbols = [], offsets = [0, 0], j;
      for (j = 0; j < n; j++) counts[lens[j]]++;
      counts[0] = 0;
      for (j = 1; j < 16; j++) offsets[j + 1] = offsets[j] + counts[j];
      for (j = 0; j < n; j++) if (lens[j]) symbols[offsets[lens[j]]++] = j;
      return { counts: counts, symbols: symbols };
    }
    function symbol(t) {
      var code = 0, first = 0, index = 0, l, n;
      for (l = 1; l < 16; l++) {
        code |= bits(1);
        n = t.counts[l];
        if (code - n < first) return t.symbols[index + code - first];
        index += n; first = (first + n) << 1; code <<= 1;
      }
    }
    var lengthBase = [], lengthExtra = [], distBase = [], distExtra = [], x = 3, y = 1, j;
    for (j = 0; j < 29; j++) { lengthExtra[j] = Math.max(0, (j >> 2) - 1); lengthBase[j] = x; x += 1 << lengthExtra[j]; }
    lengthBase[28] = 258; lengthExtra[28] = 0;
    for (j = 0; j < 30; j++) { distExtra[j] = Math.max(0, (j >> 1) - 1); distBase[j] = y; y += 1 << distExtra[j]; }
    var last, type, literals, distances, lens, len, s, dist;
    do {
      last = bits(1); type = bits(2);
      if (type == 0) {
        buf = have = 0;
        len = src[ip] | src[ip + 1] << 8; ip += 4;
        while (len--) out[op++] = src[ip++];
        continue;
      }
      if (type == 1) {
        lens = [];
        for (j = 0; j < 288; j++) lens[j] = j < 144 ? 8 : j < 256 ? 9 : j < 280 ? 7 : 8;
        literals = table(lens, 288);
        distances = table(new Array(30).fill(5), 30);
      } else {
        var nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
        var order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        lens = new Array(19).fill(0);
        for (j = 0; j < nc; j++) lens[order[j]] = bits(3);
        var lengths = table(lens, 19);
        lens = [];
        for (j = 0; j < nl + nd;) {
          s = symbol(lengths);
          if (s < 16) lens[j++] = s;
          else {
            var prev = 0, repeat;
            if (s == 16) { prev = lens[j - 1]; repeat = 3 + bits(2); }
            else if (s == 17) repeat = 3 + bits(3);
            else repeat = 11 + bits(7);
            while (repeat--) lens[j++] = prev;
          }
        }
        literals = table(lens.slice(0, nl), nl);
        distances = table(lens.slice(nl), nd);
      }
      for (;;) {
        s = symbol(literals);
        if (s < 256) out[op++] = s;
        else if (s == 256) break;
        else {
          s -= 257;
          len = lengthBase[s] + bits(lengthExtra[s]);
          s = symbol(distances);
          dist = distBase[s] + bits(distExtra[s]);
          while (len--) { out[op] = out[op - dist]; op++; }
        }
      }
    } while (!last);
    return out;
  }

  var sizes = SIZES, parts = [], at = 0, tags = ["script", "style"];
  var text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(UNPACK);
  for (i = 0; i < sizes.length; i++) { parts.push(text.substr(at, sizes[i])); at += sizes[i]; }

  self.$o = function (index, kind, attrs) {
    var cur = document.currentScript, e, a, html = "";
    if (kind == 3) cur.outerHTML = parts[index];
    else if (kind == 2) {
      for (a in attrs) html += " " + a + '="' + attrs[a].replace(/"/g, "&quot;") + '"';
      document.write("<link" + html + ' href="data:text/css;charset=utf-8,' + encodeURIComponent(parts[index]) + '">');
      cur.remove();
    } else {
      e = document.createElement(tags[kind || 0]);
      for (a in attrs) e.setAttribute(a, attrs[a]);
      e.textContent = parts[index];
      cur.replaceWith(e);
    }
  };
})();
