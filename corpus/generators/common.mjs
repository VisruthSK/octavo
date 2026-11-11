import { Buffer } from "node:buffer";

export const random = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const repeat = (count, make) => Array.from({ length: count }, (_, index) => make(index));

export const pick = (source, items) => items[Math.floor(source() * items.length) % items.length];

export const between = (source, low, high) => low + Math.floor(source() * (high - low + 1));

const NOUNS = [
  "quarto", "document", "report", "figure", "table", "section", "chapter", "widget",
  "dataset", "column", "header", "footer", "sidebar", "footnote", "citation", "slide",
  "paragraph", "appendix", "cell", "output", "theme", "caption", "reference", "appendix",
];

const VERBS = [
  "renders", "shrinks", "measures", "compares", "packs", "prunes", "embeds", "inlines",
  "reads", "writes", "parses", "prints", "keeps", "drops", "keeps", "restores",
];

export const sentence = (source) => {
  const words = [];
  for (let index = 0; index < between(source, 6, 18); index += 1) {
    words.push(pick(source, NOUNS));
  }
  return `${pick(source, VERBS)} ${words.join(" ")}.`;
};

export const paragraph = (source, count = 3) =>
  repeat(count, () => `<p>${sentence(source)}</p>`).join("\n");

const CRC = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const adler32 = (bytes) => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const stored = (bytes) => {
  const parts = [Buffer.from([0x78, 0x01])];
  const blocks = bytes.length === 0 ? 1 : Math.ceil(bytes.length / 65535);
  for (let block = 0; block < blocks; block += 1) {
    const slice = bytes.subarray(block * 65535, (block + 1) * 65535);
    const head = Buffer.alloc(5);
    head[0] = block === blocks - 1 ? 1 : 0;
    head.writeUInt16LE(slice.length, 1);
    head.writeUInt16LE(~slice.length & 0xffff, 3);
    parts.push(head, slice);
  }
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(adler32(bytes));
  parts.push(tail);
  return Buffer.concat(parts);
};

export const png = (width, height, paint) => {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw[y * width + x] = paint(x, y) & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const palette = Buffer.from([0x1a, 0x1a, 0x1a, 0xf0, 0xf0, 0xf0, 0x4c, 0x78, 0xa8, 0xe4, 0x5c, 0x3d]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", stored(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const pngDataUri = (width, height, paint) =>
  `data:image/png;base64,${png(width, height, paint).toString("base64")}`;

export const scriptUri = (code) =>
  `data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

export const styleUri = (css) => `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;

export const document = ({ lang = "en", className = "", head = "", body = "" }) =>
  `<!DOCTYPE html>
<html lang="${lang}" class="${className}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
${head}
</head>
<body>
${body}
</body>
</html>
`;
