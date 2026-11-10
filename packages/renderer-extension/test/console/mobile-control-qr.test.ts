import { describe, expect, it } from "vitest";

import { encodeQr, qrSvg } from "../../src/console/qr.js";

/** Reference versions and masks produced by `qrcode` (MIT) for byte-mode level M. */
const FIXTURES = [
  {
    value: "http://192.168.1.20:45872/?invite=" + "a".repeat(64),
    size: 41,
    mask: 0,
  },
  {
    value: "http://10.0.0.8:41000/?invite=" + "b".repeat(64) + "&pad=" + "c".repeat(30),
    size: 49,
    mask: 6,
  },
] as const;

function decodeMask(modules: boolean[][]): { mask: number | null; valid: boolean } {
  const bits: number[] = [];
  const read = (x: number, y: number): number => (modules[y]?.[x] ? 1 : 0);
  for (let index = 0; index <= 5; index += 1) bits.push(read(8, index));
  bits.push(read(8, 7), read(8, 8), read(7, 8));
  for (let index = 9; index < 15; index += 1) bits.push(read(14 - index, 8));
  let value = 0;
  for (let index = 0; index < 15; index += 1) value |= (bits[index] ?? 0) << index;
  value ^= 0x5412;
  const expected = (value >>> 10) & 0x1f;
  const data = value & 0x3ff;
  let remainder = expected << 10;
  for (let index = 14; index >= 10; index -= 1) {
    if (((remainder >>> index) & 1) !== 0) remainder ^= 0x537 << (index - 10);
  }
  return {
    mask: (expected >>> 3) & 0x7,
    valid: (remainder & 0x3ff) === data && ((expected >>> 3) & 0x3) === 0,
  };
}

describe("console QR encoder", () => {
  it.each(FIXTURES)(
    "emits a valid level-M matrix of version size $size",
    ({ value, size, mask }) => {
      const matrix = encodeQr(value);
      expect(matrix.size).toBe(size);
      expect(matrix.modules).toHaveLength(size);
      expect(matrix.modules.every((row) => row.length === size)).toBe(true);
      expect(decodeMask(matrix.modules)).toEqual({ mask, valid: true });
    },
  );

  it("keeps the finder and timing patterns intact", () => {
    const matrix = encodeQr(FIXTURES[0].value).modules;
    const finder = (x: number, y: number): void => {
      for (let dy = 0; dy < 7; dy += 1) {
        for (let dx = 0; dx < 7; dx += 1) {
          const expected =
            dx === 0 ||
            dx === 6 ||
            dy === 0 ||
            dy === 6 ||
            (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
          expect(matrix[y + dy]?.[x + dx]).toBe(expected);
        }
      }
    };
    finder(0, 0);
    finder(matrix.length - 7, 0);
    finder(0, matrix.length - 7);
    for (let index = 8; index < matrix.length - 8; index += 1) {
      expect(matrix[6]?.[index]).toBe(index % 2 === 0);
      expect(matrix[index]?.[6]).toBe(index % 2 === 0);
    }
  });

  it("renders a four-module quiet zone and a self-contained SVG", () => {
    const svg = qrSvg(
      { size: 21, modules: Array.from({ length: 21 }, () => Array<boolean>(21).fill(false)) },
      210,
    );
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('width="210"');
    expect(svg).not.toContain("<script");
  });

  it("rejects values beyond the supported version range", () => {
    expect(() => encodeQr("x".repeat(400))).toThrow("too long");
  });
});
