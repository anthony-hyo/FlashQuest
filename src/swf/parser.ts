import { Bytes } from '../utils/bytes';

export interface SwfHeader {
    frameRate: number;
    frameCount: number;
    frameSize: { xMin: number, xMax: number, yMin: number, yMax: number };
}

export interface SwfTag {
    code: number;
    length: number;
    data: Bytes;
}

export function parseSwf(buffer: ArrayBuffer | DataView): { header: SwfHeader, tags: SwfTag[] } {
    const bytes = buffer instanceof DataView ? new Bytes(buffer.buffer) : new Bytes(buffer);

    const frameSize = bytes.readRect();
    const frameRate = bytes.readUint16() / 256;
    const frameCount = bytes.readUint16();

    const header: SwfHeader = { frameRate, frameCount, frameSize };
    const tags: SwfTag[] = [];

    while (!bytes.eof) {
        const tagCodeAndLength = bytes.readUint16();
        const code = tagCodeAndLength >> 6;
        let length = tagCodeAndLength & 0x3F;
        if (length === 0x3F) length = bytes.readUint32();

        const data = length > 0 ? bytes.readBytes(length) : new Bytes(new ArrayBuffer(0));
        tags.push({ code, length, data });
    }

    return { header, tags };
}
