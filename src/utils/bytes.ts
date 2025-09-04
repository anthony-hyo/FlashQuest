import { SwfTagCode } from '../tags/tags';

export class ParserError extends Error {
    constructor(message: string, public position: number) {
        super(message);
        this.name = 'ParserError';
    }
}

export interface Matrix {
    readonly scaleX: number;
    readonly scaleY: number;
    readonly rotateSkew0: number;
    readonly rotateSkew1: number;
    readonly translateX: number;
    readonly translateY: number;
}

export interface ColorTransform {
    readonly redMultiplier: number;
    readonly greenMultiplier: number;
    readonly blueMultiplier: number;
    readonly alphaMultiplier: number;
    readonly redOffset: number;
    readonly greenOffset: number;
    readonly blueOffset: number;
    readonly alphaOffset: number;
}

export interface Rectangle {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export class Bytes {
    private readonly view: DataView;
    private bitBuffer: number = 0;
    private bitPosition: number = 0;
    private _position: number = 0;

    constructor(buffer: ArrayBuffer | ArrayBufferLike) {
        if (!buffer) {
            throw new ParserError('Buffer cannot be null or undefined', 0);
        }
        
        // Ensure we have a proper ArrayBuffer
        if (buffer instanceof ArrayBuffer) {
            this.view = new DataView(buffer);
        } else {
            // Convert ArrayBufferLike to ArrayBuffer
            this.view = new DataView(buffer.slice(0));
        }
    }

    get position(): number {
        return this._position;
    }

    private set position(value: number) {
        if (value < 0 || value > this.view.byteLength) {
            throw new ParserError(`Invalid position: ${value}. Must be between 0 and ${this.view.byteLength}`, this._position);
        }
        this._position = value;
        this.bitPosition = 0; // Reset bit position when seeking
    }

    get remaining(): number {
        return Math.max(0, this.view.byteLength - this._position);
    }

    get eof(): boolean {
        return this._position >= this.view.byteLength;
    }

    get byteLength(): number {
        return this.view.byteLength;
    }

    skip(bytes: number): void {
        if (bytes < 0) {
            throw new ParserError('Cannot skip negative bytes', this._position);
        }
        const newPosition = this._position + bytes;
        if (newPosition > this.view.byteLength) {
            throw new ParserError(`Cannot skip ${bytes} bytes from position ${this._position}, would exceed buffer bounds`, this._position);
        }
        this._position = newPosition;
        this.bitPosition = 0;
    }

    seek(position: number): void {
        this.position = position;
    }

    readUint8(): number {
        this.bitPosition = 0; // Reset bit position when reading bytes
        if (this._position >= this.view.byteLength) {
            throw new ParserError(`Unexpected end of data at position ${this._position}`, this._position);
        }
        return this.view.getUint8(this._position++);
    }

    readUint16(): number {
        this.bitPosition = 0;
        if (this._position + 2 > this.view.byteLength) {
            throw new ParserError(`Cannot read Uint16 at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getUint16(this._position, true);
        this._position += 2;
        return value;
    }

    readInt16(): number {
        this.bitPosition = 0;
        if (this._position + 2 > this.view.byteLength) {
            throw new ParserError(`Cannot read Int16 at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getInt16(this._position, true);
        this._position += 2;
        return value;
    }

    readUint32(): number {
        this.bitPosition = 0;
        if (this._position + 4 > this.view.byteLength) {
            throw new ParserError(`Cannot read Uint32 at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getUint32(this._position, true);
        this._position += 4;
        return value;
    }

    readInt32(): number {
        this.bitPosition = 0;
        if (this._position + 4 > this.view.byteLength) {
            throw new ParserError(`Cannot read Int32 at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getInt32(this._position, true);
        this._position += 4;
        return value;
    }

    readFixed(): number {
        return this.readInt32() / 65536;
    }

    readFixed8(): number {
        return this.readInt16() / 256;
    }

    readFloat(): number {
        this.bitPosition = 0;
        if (this._position + 4 > this.view.byteLength) {
            throw new ParserError(`Cannot read Float at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getFloat32(this._position, true);
        this._position += 4;
        return value;
    }

    readDouble(): number {
        this.bitPosition = 0;
        if (this._position + 8 > this.view.byteLength) {
            throw new ParserError(`Cannot read Double at position ${this._position}, not enough bytes`, this._position);
        }
        const value = this.view.getFloat64(this._position, true);
        this._position += 8;
        return value;
    }

    readEncodedU32(): number {
        let result = 0;
        let shift = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.readUint8();
            result |= (byte & 0x7F) << shift;
            shift += 7;
            if (!(byte & 0x80)) break;
            if (shift >= 32) {
                throw new ParserError('EncodedU32 overflow', this._position);
            }
        }
        return result >>> 0; // Ensure unsigned 32-bit
    }

    readString(): string {
        const startPosition = this._position;
        const chars: number[] = [];
        
        while (this._position < this.view.byteLength) {
            const byte = this.readUint8();
            if (byte === 0) break;
            chars.push(byte);
            
            // Prevent infinite loops with a reasonable limit
            if (chars.length > 65536) {
                throw new ParserError(`String too long (>65536 chars) starting at position ${startPosition}`, startPosition);
            }
        }
        
        if (this._position >= this.view.byteLength && chars.length > 0) {
            throw new ParserError(`Unterminated string starting at position ${startPosition}`, startPosition);
        }
        
        return String.fromCharCode(...chars);
    }

    readBytes(length: number): Bytes {
        if (length < 0) {
            throw new ParserError('Cannot read negative length', this._position);
        }
        if (this._position + length > this.view.byteLength) {
            throw new ParserError(`Cannot read ${length} bytes at position ${this._position}, not enough data`, this._position);
        }
        
        // Create a new view without copying the underlying buffer
        const sliceBuffer = this.view.buffer.slice(this._position, this._position + length);
        const bytes = new Bytes(sliceBuffer);
        this._position += length;
        return bytes;
    }

    readBit(): number {
        if (this.bitPosition === 0) {
            if (this._position >= this.view.byteLength) {
                throw new ParserError(`Cannot read bit at position ${this._position}, end of data`, this._position);
            }
            this.bitBuffer = this.readUint8();
            this.bitPosition = 8;
        }
        return (this.bitBuffer >> (this.bitPosition-- - 1)) & 1;
    }

    readUBits(bits: number): number {
        if (bits < 0 || bits > 32) {
            throw new ParserError(`Invalid bit count: ${bits}. Must be between 0 and 32`, this._position);
        }
        if (bits === 0) return 0;
        
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | this.readBit();
        }
        return result >>> 0; // Ensure unsigned
    }

    readSBits(bits: number): number {
        const value = this.readUBits(bits);
        const shift = 32 - bits;
        // Convert to signed
        return (value << shift) >> shift;
    }

    readUnsignedBits(bits: number): number {
        return this.readUBits(bits);
    }

    readSignedBits(bits: number): number {
        return this.readSBits(bits);
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
        
        let redMultiplier = 1;
        let greenMultiplier = 1;
        let blueMultiplier = 1;
        let alphaMultiplier = 1;
        let redOffset = 0;
        let greenOffset = 0;
        let blueOffset = 0;
        let alphaOffset = 0;

        if (hasMultipliers) {
            redMultiplier = this.readSBits(bits) / 256;
            greenMultiplier = this.readSBits(bits) / 256;
            blueMultiplier = this.readSBits(bits) / 256;
            if (hasAlpha) alphaMultiplier = this.readSBits(bits) / 256;
        }

        if (hasOffsets) {
            redOffset = this.readSBits(bits);
            greenOffset = this.readSBits(bits);
            blueOffset = this.readSBits(bits);
            if (hasAlpha) alphaOffset = this.readSBits(bits);
        }

        return {
            redMultiplier,
            greenMultiplier,
            blueMultiplier,
            alphaMultiplier,
            redOffset,
            greenOffset,
            blueOffset,
            alphaOffset
        };
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
        if (this.bitPosition > 0) {
            this._position++; // Advance to next byte if we're in the middle of one
            this.bitPosition = 0;
        }
    }
}
