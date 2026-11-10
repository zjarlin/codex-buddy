/**
 * Small QR encoder for console pairing URLs. It supports byte-mode, error correction level M,
 * versions 1-10, which covers the roughly 200-byte LAN URL this feature emits. The output is a
 * module matrix; rendering stays separate so the same data can be inspected in tests.
 */

const VERSIONS = [
  { version: 1, dataCodewords: 16, ec: 10, blocks: [1] },
  { version: 2, dataCodewords: 28, ec: 16, blocks: [1] },
  { version: 3, dataCodewords: 44, ec: 26, blocks: [1] },
  { version: 4, dataCodewords: 64, ec: 18, blocks: [2] },
  { version: 5, dataCodewords: 86, ec: 24, blocks: [2] },
  { version: 6, dataCodewords: 108, ec: 16, blocks: [4] },
  { version: 7, dataCodewords: 124, ec: 18, blocks: [4] },
  { version: 8, dataCodewords: 154, ec: 22, blocks: [2, 2] },
  { version: 9, dataCodewords: 182, ec: 22, blocks: [3, 2] },
  { version: 10, dataCodewords: 216, ec: 26, blocks: [4, 1] },
] as const;

const ALIGNMENT = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function bit(value: number, index: number): number {
  return (value >>> index) & 1;
}

/** BCH remainder used by format and version information. */
function bch(value: number, polynomial: number, bits: number): number {
  let remainder = value << bits;
  for (let index = 31; index >= bits; index -= 1) {
    if ((remainder & (1 << index)) !== 0) remainder ^= polynomial << (index - bits);
  }
  return remainder & ((1 << bits) - 1);
}

function formatBits(mask: number): number {
  // Error correction level M is 00; the version table above also uses M capacities.
  const levelAndMask = mask;
  return ((levelAndMask << 10) | bch(levelAndMask, 0x537, 10)) ^ 0x5412;
}

function versionBits(version: number): number {
  return (version << 12) | bch(version, 0x1f25, 12);
}

function gfMultiply(left: number, right: number): number {
  let result = 0;
  let a = left;
  let b = right;
  while (b > 0) {
    if ((b & 1) !== 0) result ^= a;
    a <<= 1;
    if ((a & 0x100) !== 0) a ^= 0x11d;
    b >>= 1;
  }
  return result;
}

function gfPower(exponent: number): number {
  let result = 1;
  for (let index = 0; index < exponent; index += 1) result = gfMultiply(result, 2);
  return result;
}

/** Generator coefficients in descending powers, matching the remainder long division below. */
function rsGenerator(degree: number): number[] {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const root = gfPower(index);
    const next = Array<number>(polynomial.length + 1).fill(0);
    for (let power = 0; power < polynomial.length; power += 1) {
      next[power] = (next[power] ?? 0) ^ (polynomial[power] ?? 0);
      next[power + 1] = (next[power + 1] ?? 0) ^ gfMultiply(polynomial[power] ?? 0, root);
    }
    polynomial = next;
  }
  return polynomial;
}

function rsRemainder(data: number[], degree: number): number[] {
  const generator = rsGenerator(degree);
  const result = [...data, ...Array<number>(degree).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = result[index] ?? 0;
    if (factor === 0) continue;
    for (let power = 0; power < generator.length; power += 1) {
      result[index + power] =
        (result[index + power] ?? 0) ^ gfMultiply(generator[power] ?? 0, factor);
    }
  }
  return result.slice(data.length);
}

function dataCodewords(value: string, version: number): number[] {
  const bytes = new TextEncoder().encode(value);
  const dataBits: number[] = [0, 1, 0, 0];
  const lengthBits = version < 10 ? 8 : 16;
  for (let index = lengthBits - 1; index >= 0; index -= 1) dataBits.push(bit(bytes.length, index));
  for (const byte of bytes) {
    for (let index = 7; index >= 0; index -= 1) dataBits.push(bit(byte, index));
  }
  const capacityBits = (VERSIONS[version - 1]?.dataCodewords ?? 0) * 8;
  const terminator = Math.min(4, capacityBits - dataBits.length);
  for (let index = 0; index < terminator; index += 1) dataBits.push(0);
  while (dataBits.length % 8 !== 0) dataBits.push(0);
  const words: number[] = [];
  for (let index = 0; index < dataBits.length; index += 8) {
    let valueByte = 0;
    for (let offset = 0; offset < 8; offset += 1)
      valueByte = (valueByte << 1) | (dataBits[index + offset] ?? 0);
    words.push(valueByte);
  }
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (words.length < capacityBits / 8) {
    words.push(pad[padIndex % 2] ?? 0);
    padIndex += 1;
  }
  return words;
}

function interleave(words: number[], version: number): number[] {
  const spec = VERSIONS[version - 1];
  if (!spec) throw new Error("Unsupported QR version");
  const groups = spec.blocks;
  const blockCount = groups.reduce((sum, count) => sum + count, 0);
  const totalData = words.length;
  const shortLength = Math.floor(totalData / blockCount);
  const longCount = totalData % blockCount;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const length = shortLength + (block >= blockCount - longCount ? 1 : 0);
    const data = words.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(data);
    ecBlocks.push(rsRemainder(data, spec.ec));
  }
  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let index = 0; index < maxData; index += 1) {
    for (const block of dataBlocks) if (index < block.length) result.push(block[index] ?? 0);
  }
  for (let index = 0; index < spec.ec; index += 1) {
    for (const block of ecBlocks) result.push(block[index] ?? 0);
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  return [...(ALIGNMENT[version - 1] ?? [])];
}

function makeMatrix(version: number): { modules: boolean[][]; reserved: boolean[][] } {
  const size = version * 4 + 17;
  return {
    modules: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => Array<boolean>(size).fill(false)),
  };
}

function setFunction(
  matrix: ReturnType<typeof makeMatrix>,
  x: number,
  y: number,
  value: boolean,
): void {
  if (y < 0 || x < 0 || y >= matrix.modules.length || x >= matrix.modules.length) return;
  matrix.modules[y] = matrix.modules[y] ?? [];
  matrix.reserved[y] = matrix.reserved[y] ?? [];
  matrix.modules[y][x] = value;
  matrix.reserved[y][x] = true;
}

function drawFinder(matrix: ReturnType<typeof makeMatrix>, x: number, y: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const value =
        inFinder &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunction(matrix, x + dx, y + dy, value);
    }
  }
}

function drawAlignment(
  matrix: ReturnType<typeof makeMatrix>,
  centerX: number,
  centerY: number,
): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(matrix, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawTiming(matrix: ReturnType<typeof makeMatrix>): void {
  for (let index = 8; index < matrix.modules.length - 8; index += 1) {
    setFunction(matrix, index, 6, index % 2 === 0);
    setFunction(matrix, 6, index, index % 2 === 0);
  }
}

function drawVersion(matrix: ReturnType<typeof makeMatrix>, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let index = 0; index < 18; index += 1) {
    const value = ((bits >>> index) & 1) === 1;
    const a = matrix.modules.length - 11 + (index % 3);
    const b = Math.floor(index / 3);
    setFunction(matrix, a, b, value);
    setFunction(matrix, b, a, value);
  }
}

function drawFormat(matrix: ReturnType<typeof makeMatrix>, mask: number): void {
  const bits = formatBits(mask);
  for (let index = 0; index <= 5; index += 1)
    setFunction(matrix, 8, index, ((bits >>> index) & 1) === 1);
  setFunction(matrix, 8, 7, ((bits >>> 6) & 1) === 1);
  setFunction(matrix, 8, 8, ((bits >>> 7) & 1) === 1);
  setFunction(matrix, 7, 8, ((bits >>> 8) & 1) === 1);
  for (let index = 9; index < 15; index += 1) {
    setFunction(matrix, 14 - index, 8, ((bits >>> index) & 1) === 1);
  }
  const size = matrix.modules.length;
  for (let index = 0; index < 8; index += 1) {
    setFunction(matrix, size - 1 - index, 8, ((bits >>> index) & 1) === 1);
  }
  for (let index = 8; index < 15; index += 1) {
    setFunction(matrix, 8, size - 15 + index, ((bits >>> index) & 1) === 1);
  }
  // Fixed dark module, at the row just below the second format strip.
  setFunction(matrix, 8, size - 8, true);
}

function maskValue(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function placeData(matrix: ReturnType<typeof makeMatrix>, codewords: number[], mask: number): void {
  const bits: number[] = [];
  for (const word of codewords)
    for (let index = 7; index >= 0; index -= 1) bits.push(bit(word, index));
  let index = 0;
  for (let right = matrix.modules.length - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < matrix.modules.length; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        const upward = ((matrix.modules.length - 1 - right) / 2) % 2 === 0;
        const y = upward ? matrix.modules.length - 1 - vertical : vertical;
        if (matrix.reserved[y]?.[x]) continue;
        const value = index < bits.length ? bits[index] === 1 : false;
        const row = matrix.modules[y] ?? [];
        matrix.modules[y] = row;
        row[x] = value !== maskValue(mask, x, y);
        index += 1;
      }
    }
  }
}

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  const runs = (line: boolean[]): number => {
    let total = 0;
    let run = 1;
    for (let index = 1; index < line.length; index += 1) {
      if (line[index] === line[index - 1]) run += 1;
      else {
        if (run >= 5) total += run - 2;
        run = 1;
      }
    }
    if (run >= 5) total += run - 2;
    return total;
  };
  for (let index = 0; index < size; index += 1) {
    score += runs(modules[index] ?? []);
    score += runs(modules.map((row) => row[index] ?? false));
  }
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) if (modules[y]?.[x]) dark += 1;
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

export function encodeQr(value: string): QrMatrix {
  const bytes = new TextEncoder().encode(value);
  const version = VERSIONS.find((candidate) => {
    const countBits = candidate.version < 10 ? 8 : 16;
    const requiredBits = 4 + countBits + bytes.length * 8;
    return requiredBits <= candidate.dataCodewords * 8;
  })?.version;
  if (!version) throw new Error("Pairing URL is too long for the built-in QR encoder");
  const words = interleave(dataCodewords(value, version), version);
  let best: QrMatrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = makeMatrix(version);
    drawFinder(matrix, 0, 0);
    drawFinder(matrix, matrix.modules.length - 7, 0);
    drawFinder(matrix, 0, matrix.modules.length - 7);
    drawTiming(matrix);
    const positions = alignmentPositions(version);
    for (const y of positions) {
      for (const x of positions) {
        const nearFinder =
          (x <= 8 && y <= 8) ||
          (x >= matrix.modules.length - 9 && y <= 8) ||
          (x <= 8 && y >= matrix.modules.length - 9);
        if (!nearFinder) drawAlignment(matrix, x, y);
      }
    }
    drawVersion(matrix, version);
    // Format strips are function patterns: reserve them before data placement.
    drawFormat(matrix, mask);
    placeData(matrix, words, mask);
    const score = penalty(matrix.modules);
    if (score < bestScore) {
      bestScore = score;
      best = { size: matrix.modules.length, modules: matrix.modules };
    }
  }
  if (!best) throw new Error("QR encoding failed");
  return best;
}

/** Quiet zone is four modules, as required by the QR specification. */
export function qrSvg(matrix: QrMatrix, size = 240): string {
  const quiet = 4;
  const dimension = matrix.size + quiet * 2;
  const modules = matrix.modules
    .flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : [])),
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="${size}" height="${size}" role="img" aria-label="配对二维码"><rect width="${dimension}" height="${dimension}" fill="#fff"/><path d="${modules}" fill="#111"/></svg>`;
}
