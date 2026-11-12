import { deflateSync } from "node:zlib";
import { page, random, repeat } from "../spec.mjs";

const slack = `<style>.shown { color : #036 ; }</style>`;
const markup = `<p class="shown">text</p>`;

const pageWith = (body, head = "") => page(`${slack}${head}`, body);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const sample = (x, y, channel, colorType, bitDepth, paletteSize) => {
  if (colorType === 3) return (x * 3 + y * 5) % paletteSize;
  const base = (x * 11 + y * 17 + channel * 53) % 256;
  return bitDepth === 16 ? base * 257 : base;
};

const pngRow = (width, colorType, bitDepth, y, start, step, paletteSize) => {
  const depth = bitDepth / 8;
  const count = channels[colorType];
  const row = Buffer.alloc(Math.ceil((width - start) / step) * count * depth);
  let at = 0;
  for (let x = start; x < width; x += step) {
    for (let channel = 0; channel < count; channel++) {
      const value = sample(x, y, channel, colorType, bitDepth, paletteSize);
      if (depth === 1) row[at++] = value;
      else {
        row.writeUInt16BE(value, at);
        at += 2;
      }
    }
  }
  return row;
};

const png = ({
  width,
  height,
  colorType = 2,
  bitDepth = 8,
  interlace = 0,
  paletteSize = 4,
  transparent = null,
  text = null,
  extra = [],
  level = 1,
}) => {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = bitDepth;
  head[9] = colorType;
  head[12] = interlace;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", head)];
  if (colorType === 3) {
    const table = Buffer.alloc(paletteSize * 3);
    for (let index = 0; index < paletteSize; index++) {
      table[index * 3] = (index * 61) % 256;
      table[index * 3 + 1] = (index * 97) % 256;
      table[index * 3 + 2] = (index * 29) % 256;
    }
    parts.push(pngChunk("PLTE", table));
  }
  if (transparent) parts.push(pngChunk("tRNS", transparent));
  for (const [type, data] of extra) parts.push(pngChunk(type, data));
  if (text) parts.push(pngChunk("tEXt", Buffer.from(`Comment\0${text}`, "latin1")));
  const raw = [];
  if (interlace) {
    for (const [xStart, yStart, xStep, yStep] of adam7) {
      for (let y = yStart; y < height; y += yStep) {
        raw.push(Buffer.from([0]), pngRow(width, colorType, bitDepth, y, xStart, xStep, paletteSize));
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      raw.push(Buffer.from([0]), pngRow(width, colorType, bitDepth, y, 0, 1, paletteSize));
    }
  }
  parts.push(pngChunk("IDAT", deflateSync(Buffer.concat(raw), { level })), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
};

const jpegCodes = (bits, values) => {
  const codes = new Map();
  let code = 0;
  let at = 0;
  for (let length = 1; length <= 16; length++) {
    for (let index = 0; index < bits[length - 1]; index++) {
      codes.set(values[at++], { code, length });
      code++;
    }
    code <<= 1;
  }
  return codes;
};

const dcCodes = jpegCodes([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const acCodes = jpegCodes([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0]);

const jpegCategory = (value) => {
  let magnitude = Math.abs(value);
  let bits = 0;
  while (magnitude) {
    bits++;
    magnitude >>= 1;
  }
  return bits;
};

const jpegSegment = (marker, payload) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([255, marker]), length, payload]);
};

const jpeg = (width, height, brightness) => {
  const bytes = [];
  let current = 0;
  let count = 0;
  const write = (code, length) => {
    for (let bit = length - 1; bit >= 0; bit--) {
      current = (current << 1) | ((code >> bit) & 1);
      count++;
      if (count === 8) {
        bytes.push(current & 255);
        if ((current & 255) === 255) bytes.push(0);
        current = 0;
        count = 0;
      }
    }
  };
  let previous = 0;
  for (let by = 0; by * 8 < height; by++) {
    for (let bx = 0; bx * 8 < width; bx++) {
      const quantized = Math.round((brightness(bx * 8, by * 8) - 128) / 2);
      const difference = quantized - previous;
      previous = quantized;
      const size = jpegCategory(difference);
      const entry = dcCodes.get(size);
      write(entry.code, entry.length);
      if (size) write(difference >= 0 ? difference : difference + (1 << size) - 1, size);
      write(acCodes.get(0).code, acCodes.get(0).length);
    }
  }
  if (count) {
    const padded = (current << (8 - count)) | ((1 << (8 - count)) - 1);
    bytes.push(padded & 255);
    if ((padded & 255) === 255) bytes.push(0);
  }
  const frame = Buffer.alloc(9);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 1;
  frame[6] = 1;
  frame[7] = 17;
  frame[8] = 0;
  const scan = Buffer.from([1, 1, 0, 0, 63, 0]);
  const quant = Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 16)]);
  const dcTable = Buffer.concat([
    Buffer.from([0]),
    Buffer.from([0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  ]);
  const acTable = Buffer.concat([
    Buffer.from([16]),
    Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from([0]),
  ]);
  return Buffer.concat([
    Buffer.from([255, 216]),
    jpegSegment(224, Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
    jpegSegment(219, quant),
    jpegSegment(192, frame),
    jpegSegment(196, dcTable),
    jpegSegment(196, acTable),
    jpegSegment(218, scan),
    Buffer.from(bytes),
    Buffer.from([255, 217]),
  ]);
};

const gif = (width, height, paletteSize = 4, frames = 1) => {
  const table = Buffer.alloc(paletteSize * 3);
  for (let index = 0; index < paletteSize; index++) {
    table[index * 3] = (index * 61) % 256;
    table[index * 3 + 1] = (index * 97) % 256;
    table[index * 3 + 2] = (index * 29) % 256;
  }
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  screen[4] = 0x80 | 0x70 | (Math.log2(paletteSize) - 1);
  const parts = [Buffer.from("GIF89a", "latin1"), screen, table];
  if (frames > 1) {
    parts.push(Buffer.from([33, 255, 11]), Buffer.from("NETSCAPE2.0", "latin1"), Buffer.from([3, 1, 0, 0, 0]));
  }
  for (let frame = 0; frame < frames; frame++) {
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 44;
    descriptor.writeUInt16LE(0, 1);
    descriptor.writeUInt16LE(0, 3);
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    const control = Buffer.from([33, 249, 4, 0, 255, 255, 0, 0]);
    const pixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) pixels.push((x + y + frame) % paletteSize);
    }
    const bytes = [];
    let buffer = 0;
    let count = 0;
    const emit = (code, width) => {
      buffer |= code << count;
      count += width;
      while (count >= 8) {
        bytes.push(buffer & 255);
        buffer >>= 8;
        count -= 8;
      }
    };
    for (const pixel of pixels) {
      emit(4, 3);
      emit(pixel, 3);
    }
    emit(5, 3);
    if (count) bytes.push(buffer & 255);
    const data = Buffer.from(bytes);
    parts.push(control, descriptor, Buffer.from([2]));
    for (let at = 0; at < data.length; at += 255) {
      const slice = data.subarray(at, at + 255);
      parts.push(Buffer.from([slice.length]), slice);
    }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([59]));
  return Buffer.concat(parts);
};

const webp = (width, height, [red, green, blue, alpha] = [40, 90, 160, 255]) => {
  const bytes = [];
  let buffer = 0;
  let count = 0;
  const write = (value, width) => {
    buffer |= value << count;
    count += width;
    while (count >= 8) {
      bytes.push(buffer & 255);
      buffer >>= 8;
      count -= 8;
    }
  };
  write(0x2f, 8);
  write(width - 1, 14);
  write(height - 1, 14);
  write(alpha === 255 ? 0 : 1, 1);
  write(0, 3);
  write(0, 1);
  write(0, 1);
  write(0, 1);
  for (const symbol of [green, red, blue, alpha]) {
    write(1, 1);
    write(0, 1);
    write(1, 1);
    write(symbol, 8);
  }
  write(1, 1);
  write(0, 1);
  write(0, 1);
  write(0, 1);
  if (count) bytes.push(buffer & 255);
  const payload = Buffer.from(bytes);
  const chunk = Buffer.alloc(8);
  chunk.write("VP8L", 0, "latin1");
  chunk.writeUInt32LE(payload.length, 4);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(12 + payload.length, 4);
  riff.write("WEBP", 8, "latin1");
  return Buffer.concat([riff, chunk, payload]);
};

const font = (signature, size = 96) =>
  Buffer.concat([Buffer.from(signature, "latin1"), Buffer.alloc(size, 65)]);

const base64 = (bytes) => Buffer.from(bytes).toString("base64");

const dataUri = (mime, bytes) => `data:${mime};base64,${base64(bytes)}`;

const percentUri = (mime, bytes) =>
  `data:${mime},${[...bytes].map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("")}`;

export default [
  {
    id: "assets-png-one-pixel",
    category: "images",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => pageWith(`<img alt="pixel" src="${dataUri("image/png", png({ width: 1, height: 1 }))}">`),
  },
  {
    id: "assets-png-truecolor",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="color" src="${dataUri("image/png", png({ width: 32, height: 24 }))}">`,
      ),
  },
  {
    id: "assets-png-palette",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="palette" src="${dataUri("image/png", png({ width: 16, height: 16, colorType: 3, paletteSize: 4 }))}">`,
      ),
  },
  {
    id: "assets-png-palette-with-transparency",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="palette" src="${dataUri("image/png", png({ width: 16, height: 16, colorType: 3, paletteSize: 4, transparent: Buffer.from([0, 128, 255]) }))}">`,
      ),
  },
  {
    id: "assets-png-grayscale",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="gray" src="${dataUri("image/png", png({ width: 20, height: 20, colorType: 0 }))}">`,
      ),
  },
  {
    id: "assets-png-sixteen-bit",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="deep" src="${dataUri("image/png", png({ width: 12, height: 12, colorType: 2, bitDepth: 16 }))}">`,
      ),
  },
  {
    id: "assets-png-with-alpha",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="alpha" src="${dataUri("image/png", png({ width: 12, height: 12, colorType: 6 }))}">`,
      ),
  },
  {
    id: "assets-png-interlaced",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="interlaced" src="${dataUri("image/png", png({ width: 17, height: 13, interlace: 1 }))}">`,
      ),
  },
  {
    id: "assets-png-with-ancillary-chunks",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="chunks" src="${dataUri("image/png", png({ width: 16, height: 16, extra: [["pHYs", Buffer.from([0, 14, 236, 0, 14, 236, 1])], ["tIME", Buffer.from([7, 230, 1, 2, 3, 4, 5])]] }))}">`,
      ),
  },
  {
    id: "assets-png-with-a-gamma-chunk",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="gamma" src="${dataUri("image/png", png({ width: 16, height: 16, extra: [["gAMA", Buffer.from([0, 1, 134, 160])]] }))}">`,
      ),
  },
  {
    id: "assets-png-with-a-color-profile",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="profile" src="${dataUri("image/png", png({ width: 16, height: 16, extra: [["sRGB", Buffer.from([0])]] }))}">`,
      ),
  },
  {
    id: "assets-png-with-a-text-chunk",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="commented" src="${dataUri("image/png", png({ width: 16, height: 16, text: "octavo corpus text chunk ".repeat(40) }))}">`,
      ),
  },
  {
    id: "assets-percent-encoded-png",
    category: "images",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"], removes: ["%89PNG"] },
    build: () =>
      pageWith(
        `<img alt="percent" src="${percentUri("image/png", png({ width: 24, height: 24 }))}">`,
      ),
  },
  {
    id: "assets-png-with-a-charset-parameter",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"], removes: ["charset=utf-8"] },
    build: () =>
      pageWith(
        `<img alt="charset" src="data:image/png;charset=utf-8;base64,${base64(png({ width: 24, height: 24, text: "octavo corpus text chunk ".repeat(40) }))}">`,
      ),
  },
  {
    id: "assets-png-in-a-data-src-attribute",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data-src=\"data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<img alt="lazy" data-src="${dataUri("image/png", png({ width: 16, height: 16 }))}">`,
      ),
  },
  {
    id: "assets-png-in-a-srcset",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["srcset=\""] },
    build: () => {
      const one = dataUri("image/png", png({ width: 16, height: 16 }));
      const two = dataUri("image/png", png({ width: 32, height: 32 }));
      return pageWith(`<img alt="responsive" src="${one}" srcset="${one} 1x, ${two} 2x">`);
    },
  },
  {
    id: "assets-png-as-a-css-background",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,iVBORw0KGgo"] },
    build: () => {
      const uri = dataUri("image/png", png({ width: 16, height: 16 }));
      return pageWith(
        `<div class="shown" style="background-image:url(${uri})">background</div>`,
        `<style>.shown { background-repeat : no-repeat }</style>`,
      );
    },
  },
  {
    id: "assets-truncated-png",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const bytes = png({ width: 32, height: 32 });
      const uri = dataUri("image/png", bytes.subarray(0, bytes.length - 40));
      return pageWith(`<img alt="truncated" src="${uri}">`);
    },
  },
  {
    id: "assets-corrupt-png",
    category: "images",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const bytes = png({ width: 16, height: 16 });
      bytes[30] = 0xff;
      bytes[31] = 0x00;
      bytes[40] = 0x00;
      const uri = dataUri("image/png", bytes);
      return pageWith(`<img alt="corrupt" src="${uri}">`);
    },
  },
  {
    id: "assets-png-with-a-wrong-mime",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/gif;base64,"] },
    build: () =>
      pageWith(
        `<img alt="mislabelled" src="${dataUri("image/gif", png({ width: 16, height: 16 }))}">`,
      ),
  },
  {
    id: "assets-avif-declared-png-bytes",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/avif;base64,"] },
    build: () =>
      pageWith(
        `<img alt="avif" src="${dataUri("image/avif", png({ width: 16, height: 16 }))}">`,
      ),
  },
  {
    id: "assets-base64-with-whitespace",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const uri = base64(png({ width: 16, height: 16 }));
      const spaced = `${uri.slice(0, 40)}\n${uri.slice(40, 80)}\n${uri.slice(80)}`;
      return pageWith(`<img alt="spaced" src="data:image/png;base64,${spaced}">`);
    },
  },
  {
    id: "assets-base64-with-a-missing-pad",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const uri = base64(png({ width: 16, height: 16 }));
      return pageWith(`<img alt="unpadded" src="data:image/png;base64,${uri.replace(/=+$/, "")}">`);
    },
  },
  {
    id: "assets-base64-with-an-extra-pad",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const uri = base64(png({ width: 16, height: 16 }));
      return pageWith(`<img alt="padded" src="data:image/png;base64,${uri}=">`);
    },
  },
  {
    id: "assets-jpeg-baseline",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/jpeg;base64,"] },
    build: () =>
      pageWith(
        `<img alt="jpeg" src="${dataUri("image/jpeg", jpeg(48, 32, (x, y) => 40 + ((x + y) % 180)))}">`,
      ),
  },
  {
    id: "assets-jpeg-large",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/jpeg;base64,"] },
    build: () =>
      pageWith(
        `<img alt="jpeg" src="${dataUri("image/jpeg", jpeg(320, 240, (x, y) => 30 + ((x * 3 + y * 5) % 200)))}">`,
      ),
  },
  {
    id: "assets-gif",
    category: "images",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:image/gif;base64,"] },
    build: () =>
      pageWith(`<img alt="gif" src="${dataUri("image/gif", gif(24, 16))}">`),
  },
  {
    id: "assets-gif-animated",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/gif;base64,"] },
    build: () =>
      pageWith(`<img alt="gif" src="${dataUri("image/gif", gif(16, 16, 4, 3))}">`),
  },
  {
    id: "assets-webp-lossless",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/webp;base64,"] },
    build: () =>
      pageWith(`<img alt="webp" src="${dataUri("image/webp", webp(40, 30))}">`),
  },
  {
    id: "assets-svg-data-uri-image",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/svg+xml,"] },
    build: () =>
      pageWith(
        `<img alt="svg" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23036'/%3E%3C/svg%3E">`,
      ),
  },
  {
    id: "assets-inline-svg-with-a-script",
    category: "images",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["window.assetsSvg = 1"] },
    build: () =>
      pageWith(
        `<svg viewBox="0 0 16 16"><script>window.assetsSvg = 1</script><circle cx="8" cy="8" r="6"/></svg>`,
      ),
  },
  {
    id: "assets-inline-svg-with-a-style",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["<style>.assets-shape{fill:red}</style>"] },
    build: () =>
      pageWith(
        `<svg viewBox="0 0 16 16"><style>.assets-shape{fill:red}</style><circle class="assets-shape" cx="8" cy="8" r="6"/></svg>`,
      ),
  },
  {
    id: "assets-image-inside-an-inline-svg",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `<svg viewBox="0 0 16 16"><image href="${dataUri("image/png", png({ width: 16, height: 16 }))}" width="16" height="16"/></svg>`,
      ),
  },
  {
    id: "assets-duplicated-images",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const uri = dataUri("image/png", png({ width: 24, height: 24 }));
      return pageWith(`<img alt="one" src="${uri}"><img alt="two" src="${uri}">`);
    },
  },
  {
    id: "assets-many-images",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () => {
      const next = random(20240218);
      const images = repeat(
        40,
        (index) =>
          `<img alt="image ${index}" src="${dataUri("image/png", png({ width: 8 + Math.floor(next() * 24), height: 8 + Math.floor(next() * 24) }))}">`,
      );
      return pageWith(images);
    },
  },
  {
    id: "assets-large-image",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:image/png;base64,"] },
    build: () =>
      pageWith(
        `${markup}<img alt="large" src="${dataUri("image/png", png({ width: 900, height: 900 }))}">`,
        `<style>.shown { color : #036 ; font-family : Georgia , serif ; font-size : 16px ; line-height : 1.6 ; letter-spacing : .01em ; border : 1px solid #d0d0d0 ; border-radius : 4px ; padding : 12px ; margin : 0 auto ; background : #ffffff ; box-shadow : 0 1px 2px rgba(0,0,0,.1) ; text-align : left ; overflow : hidden ; word-break : break-word }</style>`,
      ),
  },
  {
    id: "assets-image-with-width-and-height",
    category: "images",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["width=\"64\"", "height=\"48\""] },
    build: () =>
      pageWith(
        `<img alt="sized" width="64" height="48" src="${dataUri("image/png", png({ width: 64, height: 48 }))}">`,
      ),
  },
  {
    id: "assets-ttf-with-corrupt-data",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : Corrupt ; src : url(${uri}) } p { font-family : Corrupt }</style>`,
      );
    },
  },
  {
    id: "assets-woff-with-corrupt-data",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:font/woff;base64,"] },
    build: () => {
      const uri = dataUri("font/woff", font("wOFF"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : Corrupt ; src : url(${uri}) } p { font-family : Corrupt }</style>`,
      );
    },
  },
  {
    id: "assets-woff2-with-corrupt-data",
    category: "fonts",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["data:font/woff2;base64,"] },
    build: () => {
      const uri = dataUri("font/woff2", font("wOF2"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : Corrupt ; src : url(${uri}) } p { font-family : Corrupt }</style>`,
      );
    },
  },
  {
    id: "assets-otf-with-corrupt-data",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:font/otf;base64,"] },
    build: () => {
      const uri = dataUri("font/otf", font("OTTO"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : Corrupt ; src : url(${uri}) } p { font-family : Corrupt }</style>`,
      );
    },
  },
  {
    id: "assets-unused-font-face-is-dropped",
    category: "fonts",
    tier: "smoke",
    expect: { outcome: "optimizes", removes: ["GhostFamily"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : GhostFamily ; src : url(${uri}) }</style>`,
      );
    },
  },
  {
    id: "assets-font-named-by-a-script-is-kept",
    category: "fonts",
    tier: "smoke",
    expect: { outcome: "optimizes", retains: ["@font-face", "data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        `${markup}<script>window.assetsFontName = "ScriptFont"</script>`,
        `<style>@font-face { font-family : ScriptFont ; src : url(${uri}) }</style>`,
      );
    },
  },
  {
    id: "assets-icon-font-with-corrupt-data",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        `<p class="shown assets-icon">icon</p>`,
        `<style>@font-face { font-family : Icons ; src : url(${uri}) } .assets-icon::before { content : "\\f101" ; font-family : Icons }</style>`,
      );
    },
  },
  {
    id: "assets-font-faces-with-unicode-ranges",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["U+4E00", "U+1F600"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      const face = (range) => `@font-face { font-family : RangeFont ; src : url(${uri}) ; unicode-range : ${range} }`;
      return pageWith(
        markup,
        `<style>${face("U+0020")} ${face("U+4E00")} ${face("U+1F600")} p { font-family : RangeFont }</style>`,
      );
    },
  },
  {
    id: "assets-font-with-an-escaped-family-name",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : "\\42 \\4f \\4f" ; src : url(${uri}) } p { font-family : "\\42 \\4f \\4f" }</style>`,
      );
    },
  },
  {
    id: "assets-font-referenced-through-a-custom-property",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["@font-face", "data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        markup,
        `<style>:root { --heading : Vault , serif } @font-face { font-family : Vault ; src : url(${uri}) } p { font-family : var(--heading) }</style>`,
      );
    },
  },
  {
    id: "assets-font-in-a-data-uri-stylesheet",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["@font-face", "data:font/ttf;base64,"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      const sheet = `@font-face{font-family:LinkFont;src:url(${uri})}p{font-family:LinkFont}`;
      return pageWith(
        markup,
        `<link rel="stylesheet" href="data:text/css,${encodeURIComponent(sheet)}">`,
      );
    },
  },
  {
    id: "assets-two-fonts-one-used",
    category: "fonts",
    tier: "full",
    expect: { outcome: "optimizes", retains: ["KeptFont"], removes: ["DroppedFont"] },
    build: () => {
      const uri = dataUri("font/ttf", font("\u0000\u0001\u0000\u0000"));
      return pageWith(
        markup,
        `<style>@font-face { font-family : KeptFont ; src : url(${uri}) } @font-face { font-family : DroppedFont ; src : url(${uri}) } p { font-family : KeptFont }</style>`,
      );
    },
  },
];

export { png };
