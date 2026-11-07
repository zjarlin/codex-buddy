/**
 * Minimal SpreadsheetML writer: a ZIP of stored (uncompressed) XML parts holding one worksheet
 * per sheet. It exists so exports open as real workbooks in Excel without pulling a spreadsheet
 * library into the Renderer bundle.
 */

/** A styled number keeps its native type so Excel can sum the column. */
export interface StyledNumber {
  readonly number: number;
  readonly style: "integer" | "money" | "percent";
}
export type Cell = string | number | null | StyledNumber;
export type Row = readonly Cell[];
export type Sheet = { name: string; rows: readonly Row[] };
type Style = "default" | "header" | "integer" | "money" | "percent";

const STYLE_IDS: Record<Style, number> = {
  default: 0,
  header: 1,
  integer: 2,
  money: 3,
  percent: 4,
};

const encoder = new TextEncoder();

function xml(value: string): string {
  return (
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
      // Control characters are not valid XML 1.0 text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
  );
}

function column(index: number): string {
  let name = "";
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

function isStyledNumber(cell: Cell): cell is StyledNumber {
  return typeof cell === "object" && cell !== null && "number" in cell;
}

function cellXml(cell: Cell, rowIndex: number, columnIndex: number, header: boolean): string {
  const reference = `${column(columnIndex)}${rowIndex + 1}`;
  const style = header ? "header" : isStyledNumber(cell) ? cell.style : "default";
  const id = STYLE_IDS[style];
  const attributes = id === 0 ? "" : ` s="${id}"`;
  if (cell === null) return `<c r="${reference}"${attributes}/>`;
  const value = isStyledNumber(cell) ? cell.number : cell;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"${attributes}><v>${value}</v></c>`;
  }
  return `<c r="${reference}"${attributes} t="inlineStr"><is><t xml:space="preserve">${xml(
    String(value),
  )}</t></is></c>`;
}

function worksheetXml(rows: readonly Row[]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => cellXml(cell, rowIndex, columnIndex, rowIndex === 0))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function sheetName(name: string, index: number): string {
  // Excel limits: 31 characters and none of : \ / ? * [ ]
  const cleaned = name
    .replace(/[:\\/?*[\]]/gu, " ")
    .trim()
    .slice(0, 31);
  return cleaned.length > 0 ? cleaned : `Sheet${index + 1}`;
}

/** A workbook whose cells keep their type: numbers stay numeric, so Excel can sum them. */
export class Workbook {
  readonly #sheets: Sheet[] = [];

  sheet(name: string, rows: readonly Row[]): this {
    this.#sheets.push({ name, rows });
    return this;
  }

  get size(): number {
    return this.#sheets.length;
  }

  /** The workbook as bytes, ready for a Blob download. */
  toBytes(): Uint8Array {
    if (this.#sheets.length === 0) throw new Error("Workbook has no sheets");
    const names = this.#sheets.map((sheet, index) => sheetName(sheet.name, index));
    const parts: Array<{ name: string; data: Uint8Array }> = [];
    parts.push({
      name: "[Content_Types].xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${this.#sheets
          .map(
            (_sheet, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("")}</Types>`,
      ),
    });
    parts.push({
      name: "_rels/.rels",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    });
    parts.push({
      name: "xl/workbook.xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
          .map(
            (name, index) =>
              `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
          )
          .join("")}</sheets></workbook>`,
      ),
    });
    parts.push({
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.#sheets
          .map(
            (_sheet, index) =>
              `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
          )
          .join(
            "",
          )}<Relationship Id="rId${this.#sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    });
    parts.push({ name: "xl/styles.xml", data: encoder.encode(stylesXml()) });
    for (const [index, sheet] of this.#sheets.entries()) {
      parts.push({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        data: encoder.encode(worksheetXml(sheet.rows)),
      });
    }
    return zip(parts);
  }
}

/** A count cell with thousands separators. */
export function integer(value: number): StyledNumber {
  return { number: value, style: "integer" };
}

/** A USD cell with two decimals. */
export function money(value: number): StyledNumber {
  return { number: value, style: "money" };
}

/** A 0–1 ratio shown as 0.0%. */
export function ratio(value: number): StyledNumber {
  return { number: value, style: "percent" };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time; a fixed January 2024 stamp keeps exports byte-stable. */
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

function zip(parts: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    const crc = crc32(part.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, DOS_TIME, true);
    view.setUint16(12, DOS_DATE, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, part.data.length, true);
    view.setUint32(22, part.data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, part.data);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, DOS_TIME, true);
    centralView.setUint16(14, DOS_DATE, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, part.data.length, true);
    centralView.setUint32(24, part.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + part.data.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, parts.length, true);
  endView.setUint16(10, parts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const total = locals.reduce((size, part) => size + part.length, 0) + centralSize + end.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of locals) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(end, cursor);
  return output;
}
