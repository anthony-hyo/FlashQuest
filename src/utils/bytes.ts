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
    public bitPosition: number = 0; // ISSUE: Made public for debugging, should be encapsulated with getter/setter
    private _position: number = 0;

    constructor(buffer: ArrayBuffer | ArrayBufferLike) {
        if (!buffer) {
            throw new ParserError('Buffer cannot be null or undefined', 0);
        }
        
        // ISSUE: Type safety - ArrayBufferLike cast could hide issues with SharedArrayBuffer
        // Allow empty buffers for zero-length tags
        this.view = new DataView(buffer as ArrayBuffer);
    }

    get position(): number {
        return this._position;
    }

    set position(value: number) {
        if (value < 0 || value > this.view.byteLength) {
            throw new ParserError(`Invalid position: ${value}. Must be between 0 and ${this.view.byteLength}`, 0);
        }
        this._position = value;
        this.bitPosition = 0; // Reset bit position when seeking
    }

    get remaining(): number {
        return this.view.byteLength - this._position;
    }

    get eof(): boolean {
        return this._position >= this.view.byteLength;
    }

    skip(bytes: number): void {
        if (bytes < 0) {
            throw new ParserError('Cannot skip negative bytes', 0);
        }
        // ISSUE: No bounds checking - could skip beyond buffer end
        this._position += bytes;
    }

    readUint8(): number {
        this.bitPosition = 0; // Reset bit position when reading bytes
        if (this._position >= this.view.byteLength) {
            throw new ParserError(`Unexpected end of data at position ${this._position}`, 0);
        }
        return this.view.getUint8(this._position++);
    }

    readUint16(): number {
        this.bitPosition = 0;
        if (this._position + 2 > this.view.byteLength) {
            throw new ParserError(`Cannot read Uint16 at position ${this._position}, not enough bytes`, 0);
        }
        const value = this.view.getUint16(this._position, true);
        this._position += 2;
        return value;
    }

    readInt16(): number {
        this.bitPosition = 0;
        if (this._position + 2 > this.view.byteLength) {
            throw new ParserError(`Cannot read Int16 at position ${this._position}, not enough bytes`, 0);
        }
        const value = this.view.getInt16(this._position, true);
        this._position += 2;
        return value;
    }

    readUint32(): number {
        this.bitPosition = 0;
        if (this._position + 4 > this.view.byteLength) {
            throw new ParserError(`Cannot read Uint32 at position ${this._position}, not enough bytes`, 0);
        }
        const value = this.view.getUint32(this._position, true);
        this._position += 4;
        return value;
    }

    readInt32(): number {
        this.bitPosition = 0;
        if (this._position + 4 > this.view.byteLength) {
            throw new ParserError(`Cannot read Int32 at position ${this._position}, not enough bytes`, 0);
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
            throw new ParserError(`Cannot read Float at position ${this._position}, not enough bytes`, 0);
        }
        const value = this.view.getFloat32(this._position, true);
        this._position += 4;
        return value;
    }

    readDouble(): number {
        this.bitPosition = 0;
        if (this._position + 8 > this.view.byteLength) {
            throw new ParserError(`Cannot read Double at position ${this._position}, not enough bytes`, 0);
        }
        const value = this.view.getFloat64(this._position, true);
        this._position += 8;
        return value;
    }

    readEncodedU32(): number {
        // PERFORMANCE: This method could be optimized by reading larger chunks
        // TYPE SAFETY: Should validate that result stays within U32 bounds
        let result = 0;
        let shift = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.readUint8();
            result |= (byte & 0x7F) << shift;
            shift += 7;
            if (!(byte & 0x80)) break;
            if (shift >= 32) {
                throw new ParserError('EncodedU32 overflow', 0);
            }
        }
        return result >>> 0; // Ensure unsigned 32-bit
    }

    readString(): string {
        const startPosition = this._position;
        let result = '';
        
        // PERFORMANCE: String concatenation in loop is inefficient, should use array + join
        // SECURITY: No encoding validation - assumes ASCII/UTF-8
        while (this._position < this.view.byteLength) {
            const byte = this.readUint8();
            if (byte === 0) break;
            result += String.fromCharCode(byte);
            
            // Prevent infinite loops with a reasonable limit
            if (result.length > 65536) {
                throw new ParserError(`String too long (>65536 chars) starting at position ${startPosition}`, 0);
            }
        }
        
        if (this._position >= this.view.byteLength && result.length > 0) {
            throw new ParserError(`Unterminated string starting at position ${startPosition}`, 0);
        }
        
        return result;
    }

    readBytes(length: number): Bytes {
        if (length < 0) {
            throw new ParserError('Cannot read negative length', 0);
        }
        if (this._position + length > this.view.byteLength) {
            throw new ParserError(`Cannot read ${length} bytes at position ${this._position}, not enough data`, 0);
        }
        // PERFORMANCE: Buffer slicing creates new ArrayBuffer copy - expensive for large data
        const bytes = new Bytes(this.view.buffer.slice(this._position, this._position + length));
        this._position += length;
        return bytes;
    }

    readBit(): number {
        if (this.bitPosition === 0) {
            if (this._position >= this.view.byteLength) {
                throw new ParserError(`Cannot read bit at position ${this._position}, end of data`, 0);
            }
            this.bitBuffer = this.readUint8();
            this.bitPosition = 8;
        }
        // ISSUE: Bit ordering might be incorrect for SWF format (MSB vs LSB first)
        return (this.bitBuffer >> (this.bitPosition-- - 1)) & 1;
    }

    readUBits(bits: number): number {
        if (bits < 0 || bits > 32) {
            throw new ParserError(`Invalid bit count: ${bits}. Must be between 0 and 32`, 0);
        }
        if (bits === 0) return 0;
        
        // PERFORMANCE: Could be optimized by reading multiple bytes at once
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
        if (this.bitPosition > 0) {
            this._position++; // Advance to next byte if we're in the middle of one
            this.bitPosition = 0;
        }
    }
}
