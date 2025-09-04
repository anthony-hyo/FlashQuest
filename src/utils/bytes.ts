import { SwfTagCode } from '../tags/tags';

export class ParserError extends Error {
    constructor(message: string, public code: number) {
        super(message);
        this.name = 'ParserError';
    }
}

export interface Matrix {
    scaleX: number;
    scaleY: number;
    rotateSkew0: number;
    rotateSkew1: number;
    translateX: number;
    translateY: number;
}

export interface ColorTransform {
    redMultiplier: number;
    greenMultiplier: number;
    blueMultiplier: number;
    alphaMultiplier: number;
    redOffset: number;
    greenOffset: number;
    blueOffset: number;
    alphaOffset: number;
}

export class Bytes {
    private view: DataView;
    private bitBuffer: number = 0;
    private bitPosition: number = 8;
    position: number = 0;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    get remaining(): number {
        return this.view.byteLength - this.position;
    }

    readUint8(): number {
        this.bitPosition = 8; // Reset bit position when reading bytes
        if (this.position >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        return this.view.getUint8(this.position++);
    }

    readUint16(): number {
        this.bitPosition = 8;
        if (this.position + 1 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getUint16(this.position, true);
        this.position += 2;
        return value;
    }

    readInt16(): number {
        this.bitPosition = 8;
        if (this.position + 1 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getInt16(this.position, true);
        this.position += 2;
        return value;
    }

    readUint32(): number {
        this.bitPosition = 8;
        if (this.position + 3 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getUint32(this.position, true);
        this.position += 4;
        return value;
    }

    readInt32(): number {
        this.bitPosition = 8;
        if (this.position + 3 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getInt32(this.position, true);
        this.position += 4;
        return value;
    }

    readFixed(): number {
        return this.readInt32() / 65536;
    }

    readFixed8(): number {
        return this.readInt16() / 256;
    }

    readFloat(): number {
        this.bitPosition = 8;
        if (this.position + 3 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getFloat32(this.position, true);
        this.position += 4;
        return value;
    }

    readDouble(): number {
        this.bitPosition = 8;
        if (this.position + 7 >= this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const value = this.view.getFloat64(this.position, true);
        this.position += 8;
        return value;
    }

    readEncodedU32(): number {
        let result = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.readUint8();
            result |= (byte & 0x7F) << (7 * i);
            if (!(byte & 0x80)) break;
        }
        return result;
    }

    readString(): string {
        let result = '';
        while (true) {
            if (this.position >= this.view.byteLength) {
                throw new ParserError('Unexpected end of data', SwfTagCode.End);
            }
            const byte = this.readUint8();
            if (byte === 0) break;
            result += String.fromCharCode(byte);
        }
        return result;
    }

    readBytes(length: number): Bytes {
        if (this.position + length > this.view.byteLength) {
            throw new ParserError('Unexpected end of data', SwfTagCode.End);
        }
        const bytes = new Bytes(this.view.buffer.slice(this.position, this.position + length));
        this.position += length;
        return bytes;
    }

    readBit(): number {
        if (this.bitPosition === 8) {
            this.bitBuffer = this.readUint8();
            this.bitPosition = 0;
        }
        return (this.bitBuffer >> (7 - this.bitPosition++)) & 1;
    }

    readUBits(bits: number): number {
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | this.readBit();
        }
        return result;
    }

    readSBits(bits: number): number {
        const value = this.readUBits(bits);
        const shift = 32 - bits;
        return (value << shift) >> shift;
    }

    readMatrix(): Matrix {
        let hasScale = this.readBit() === 1;
        let scaleX = 1, scaleY = 1;
        if (hasScale) {
            const bits = this.readUBits(5);
            scaleX = this.readSBits(bits) / 65536;
            scaleY = this.readSBits(bits) / 65536;
        }

        let hasRotate = this.readBit() === 1;
        let rotateSkew0 = 0, rotateSkew1 = 0;
        if (hasRotate) {
            const bits = this.readUBits(5);
            rotateSkew0 = this.readSBits(bits) / 65536;
            rotateSkew1 = this.readSBits(bits) / 65536;
        }

        const translateBits = this.readUBits(5);
        const translateX = this.readSBits(translateBits);
        const translateY = this.readSBits(translateBits);

        return { scaleX, scaleY, rotateSkew0, rotateSkew1, translateX, translateY };
    }

    readColorTransform(hasAlpha: boolean): ColorTransform {
        const bits = this.readUBits(4);
        const hasMultipliers = this.readBit() === 1;
        const hasOffsets = this.readBit() === 1;
        
        let transform: ColorTransform = {
            redMultiplier: 1,
            greenMultiplier: 1,
            blueMultiplier: 1,
            alphaMultiplier: 1,
            redOffset: 0,
            greenOffset: 0,
            blueOffset: 0,
            alphaOffset: 0
        };

        if (hasMultipliers) {
            transform.redMultiplier = this.readSBits(bits) / 256;
            transform.greenMultiplier = this.readSBits(bits) / 256;
            transform.blueMultiplier = this.readSBits(bits) / 256;
            if (hasAlpha) transform.alphaMultiplier = this.readSBits(bits) / 256;
        }

        if (hasOffsets) {
            transform.redOffset = this.readSBits(bits);
            transform.greenOffset = this.readSBits(bits);
            transform.blueOffset = this.readSBits(bits);
            if (hasAlpha) transform.alphaOffset = this.readSBits(bits);
        }

        return transform;
    }

    readRect(): { xMin: number; xMax: number; yMin: number; yMax: number } {
        const bits = this.readUBits(5);
        return {
            xMin: this.readSBits(bits),
            xMax: this.readSBits(bits),
            yMin: this.readSBits(bits),
            yMax: this.readSBits(bits)
        };
    }

    align(): void {
        this.bitPosition = 8;
    }
}
