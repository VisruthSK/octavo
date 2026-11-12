import { png } from "../../docs/assets.mjs";

export default () => ({
  "img/spacer.png": png({ width: 64, height: 64, colorType: 3, paletteSize: 1, transparent: Buffer.from([0]) }),
  "img/dot.png": png({ width: 64, height: 64 }),
});
