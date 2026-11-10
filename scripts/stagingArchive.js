const zlib = require('node:zlib');
const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
    return value >>> 0;
});
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function safeName(name) {
    if (!name || name.startsWith('/') || /[\\:\0]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe archive entry.');
    return name;
}
function createZip(entries) {
    const local = [], central = []; let offset = 0;
    for (const [name, content] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const filename = Buffer.from(safeName(name)), data = Buffer.from(content), compressed = zlib.deflateRawSync(data, { level: 9 });
        if (data.length > 0xffffffff || offset > 0xffffffff || filename.length > 65535) throw new Error('ZIP64 not supported.');
        const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
        header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
        local.push(header, filename, compressed);
        const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6);
        header.copy(record, 8, 6, 28); record.writeUInt32LE((0o100644 * 65536) >>> 0, 38); record.writeUInt32LE(offset, 42);
        central.push(record, filename); offset += header.length + filename.length + compressed.length;
    }
    if (entries.size > 65535) throw new Error('Too many entries.');
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
function readZip(buffer) {
    const end = buffer.length - 22;
    if (end < 0 || buffer.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP trailer.');
    const count = buffer.readUInt16LE(end + 10), result = new Map(); let cursor = buffer.readUInt32LE(end + 16);
    for (let index = 0; index < count; index++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50 || buffer.readUInt16LE(cursor + 10) !== 8) throw new Error('Invalid ZIP directory.');
        const size = buffer.readUInt32LE(cursor + 20), plainSize = buffer.readUInt32LE(cursor + 24), nameSize = buffer.readUInt16LE(cursor + 28);
        const name = safeName(buffer.subarray(cursor + 46, cursor + 46 + nameSize).toString());
        const offset = buffer.readUInt32LE(cursor + 42);
        if (result.has(name) || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP entry.');
        const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
        const data = zlib.inflateRawSync(buffer.subarray(start, start + size), { maxOutputLength: Math.max(plainSize, 1) });
        if (data.length !== plainSize || crc32(data) !== buffer.readUInt32LE(cursor + 16)) throw new Error('ZIP integrity failure.');
        result.set(name, data); cursor += 46 + nameSize + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
    }
    return result;
}
module.exports = { createZip, readZip, safeName };
