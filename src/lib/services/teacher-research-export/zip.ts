export type ZipEntryInput = {
  path: string;
  data: string | Buffer;
};

type CentralDirectoryEntry = {
  pathBuffer: Buffer;
  crc32: number;
  size: number;
  offset: number;
};

let crc32Table: number[] | null = null;

function getCrc32Table() {
  if (crc32Table) {
    return crc32Table;
  }

  crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });

  return crc32Table;
}

function crc32(buffer: Buffer) {
  const table = getCrc32Table();
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function localFileHeader(input: {
  pathBuffer: Buffer;
  crc32: number;
  size: number;
}) {
  return Buffer.concat([
    uint32(0x04034b50),
    uint16(20),
    uint16(0x0800),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(input.crc32),
    uint32(input.size),
    uint32(input.size),
    uint16(input.pathBuffer.length),
    uint16(0),
    input.pathBuffer
  ]);
}

function centralDirectoryHeader(entry: CentralDirectoryEntry) {
  return Buffer.concat([
    uint32(0x02014b50),
    uint16(20),
    uint16(20),
    uint16(0x0800),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(entry.crc32),
    uint32(entry.size),
    uint32(entry.size),
    uint16(entry.pathBuffer.length),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    uint32(0),
    uint32(entry.offset),
    entry.pathBuffer
  ]);
}

export function createStoreOnlyZip(entries: ZipEntryInput[]) {
  const fileBuffers: Buffer[] = [];
  const centralEntries: CentralDirectoryEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const pathBuffer = Buffer.from(entry.path, "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, "utf8");
    const checksum = crc32(dataBuffer);
    const header = localFileHeader({
      pathBuffer,
      crc32: checksum,
      size: dataBuffer.length
    });

    fileBuffers.push(header, dataBuffer);
    centralEntries.push({
      pathBuffer,
      crc32: checksum,
      size: dataBuffer.length,
      offset
    });
    offset += header.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralEntries.map(centralDirectoryHeader));
  const centralDirectoryOffset = offset;
  const endOfCentralDirectory = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralEntries.length),
    uint16(centralEntries.length),
    uint32(centralDirectory.length),
    uint32(centralDirectoryOffset),
    uint16(0)
  ]);

  return Buffer.concat([...fileBuffers, centralDirectory, endOfCentralDirectory]);
}
