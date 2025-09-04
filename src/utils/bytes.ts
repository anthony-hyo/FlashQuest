export class Bytes {
    readonly dataView: DataView;
    position: number = 0;
    bitPosition: number = 0;

    constructor(buffer: ArrayBufferLike) {
        this.dataView = new DataView(buffer);
    }

    readUint8(): number {
        if (this.position >= this.dataView.byteLength) {
            throw new Error('Tentativa de leitura além do buffer');
        }
        const value = this.dataView.getUint8(this.position);
        this.position += 1;
        return value;
    }

    readUint16(): number {
        if (this.position + 1 >= this.dataView.byteLength) {
            throw new Error('Tentativa de leitura além do buffer');
        }
        const value = this.dataView.getUint16(this.position, true);
        this.position += 2;
        return value;
    }

    readInt16(): number {
        if (this.position + 1 >= this.dataView.byteLength) {
            throw new Error('Tentativa de leitura além do buffer');
        }
        const value = this.dataView.getInt16(this.position, true);
        this.position += 2;
        return value;
    }

    readUint32(): number {
        if (this.position + 3 >= this.dataView.byteLength) {
            throw new Error('Tentativa de leitura além do buffer');
        }
        const value = this.dataView.getUint32(this.position, true);
        this.position += 4;
        return value;
    }

    readInt32(): number {
        if (this.position + 3 >= this.dataView.byteLength) {
            throw new Error('Tentativa de leitura além do buffer');
        }
        const value = this.dataView.getInt32(this.position, true);
        this.position += 4;
        return value;
    }

    readFixed(): number {
        const value = this.readInt32() / 65536.0;
        return value;
    }

    readFixed8(): number {
        const value = this.readInt16() / 256.0;
        return value;
    }

    readEncodedU32(): number {
        let value = 0;
        let shift = 0;
        let byte;
        do {
            byte = this.readUint8();
            value |= (byte & 0x7F) << shift;
            shift += 7;
        } while (byte & 0x80);
        return value;
    }

    readRect(): { xMin: number, xMax: number, yMin: number, yMax: number } {
        const startPos: number = this.position;

        if (this.position >= this.dataView.byteLength) {
            return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
        }

        const nBits: number = this.readUint8() >> 3;
        this.position = startPos;
        this.bitPosition = 5;

        const xMin = this.readSignedBits(nBits);
        const xMax = this.readSignedBits(nBits);
        const yMin = this.readSignedBits(nBits);
        const yMax = this.readSignedBits(nBits);

        this.align();

        return { xMin, xMax, yMin, yMax };
    }

    readSignedBits(n: number): number {
        if (n === 0) return 0;

        let num = 0;
        for (let i = n - 1; i >= 0; i--) {
            if (this.readBit()) {
                num |= (1 << i);
            }
        }

        // Verificar se é negativo (bit mais significativo)
        if (num & (1 << (n - 1))) {
            num -= (1 << n);
        }
        return num;
    }

    readUnsignedBits(n: number): number {
        if (n === 0) return 0;

        let num = 0;
        for (let i = n - 1; i >= 0; i--) {
            if (this.readBit()) {
                num |= (1 << i);
            }
        }
        return num;
    }

    readBit(): number {
        if (this.position >= this.dataView.byteLength) {
            return 0;
        }

        const bit = (this.dataView.getUint8(this.position) >> (7 - (this.bitPosition % 8))) & 1;
        this.bitPosition++;

        if (this.bitPosition % 8 === 0) {
            this.position++;
            this.bitPosition = 0;
        }
        return bit;
    }

    align() {
        if (this.bitPosition % 8 !== 0) {
            this.position++;
        }
        this.bitPosition = 0;
    }

    get eof(): boolean {
        return this.position >= this.dataView.byteLength;
    }

    get remaining(): number {
        return this.dataView.byteLength - this.position;
    }

    skip(length: number) {
        this.position = Math.min(this.position + length, this.dataView.byteLength);
    }

    readBytes(length: number): Bytes {
        const endPos = Math.min(this.position + length, this.dataView.byteLength);
        const bytes = new Bytes(this.dataView.buffer.slice(this.position, endPos));
        this.position = endPos;
        return bytes;
    }

    readString(length?: number): string {
        if (length === undefined) {
            // Ler até null terminator
            const start = this.position;
            while (this.position < this.dataView.byteLength && this.dataView.getUint8(this.position) !== 0) {
                this.position++;
            }
            const result = new TextDecoder().decode(this.dataView.buffer.slice(start, this.position));
            if (this.position < this.dataView.byteLength) {
                this.position++; // Pular null terminator
            }
            return result;
        } else {
            const bytes = new Uint8Array(this.dataView.buffer, this.position, Math.min(length, this.remaining));
            this.position += bytes.length;
            return new TextDecoder().decode(bytes);
        }
    }

    readMatrix(): Matrix {
        this.align();

        const hasScale = this.readBit();
        let scaleX = 1, scaleY = 1;

        if (hasScale) {
            const nScaleBits = this.readUnsignedBits(5);
            scaleX = this.readSignedBits(nScaleBits) / 65536;
            scaleY = this.readSignedBits(nScaleBits) / 65536;
        }

        const hasRotate = this.readBit();
        let rotateSkew0 = 0, rotateSkew1 = 0;

        if (hasRotate) {
            const nRotateBits = this.readUnsignedBits(5);
            rotateSkew0 = this.readSignedBits(nRotateBits) / 65536;
            rotateSkew1 = this.readSignedBits(nRotateBits) / 65536;
        }

        const nTranslateBits = this.readUnsignedBits(5);
        const translateX = this.readSignedBits(nTranslateBits);
        const translateY = this.readSignedBits(nTranslateBits);

        this.align();

        return {
            scaleX,
            scaleY,
            rotateSkew0,
            rotateSkew1,
            translateX,
            translateY
        };
    }

    readColorTransform(hasAlpha: boolean = false): ColorTransform {
        this.align();

        const hasAddTerms = this.readBit();
        const hasMultTerms = this.readBit();
        const nBits = this.readUnsignedBits(4);

        let redMultTerm = 1, greenMultTerm = 1, blueMultTerm = 1, alphaMultTerm = 1;
        let redAddTerm = 0, greenAddTerm = 0, blueAddTerm = 0, alphaAddTerm = 0;

        if (hasMultTerms) {
            redMultTerm = this.readSignedBits(nBits) / 256;
            greenMultTerm = this.readSignedBits(nBits) / 256;
            blueMultTerm = this.readSignedBits(nBits) / 256;
            if (hasAlpha) {
                alphaMultTerm = this.readSignedBits(nBits) / 256;
            }
        }

        if (hasAddTerms) {
            redAddTerm = this.readSignedBits(nBits);
            greenAddTerm = this.readSignedBits(nBits);
            blueAddTerm = this.readSignedBits(nBits);
            if (hasAlpha) {
                alphaAddTerm = this.readSignedBits(nBits);
            }
        }

        this.align();

        return {
            redMultTerm,
            greenMultTerm,
            blueMultTerm,
            alphaMultTerm,
            redAddTerm,
            greenAddTerm,
            blueAddTerm,
            alphaAddTerm
        };
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
    redMultTerm: number;
    greenMultTerm: number;
    blueMultTerm: number;
    alphaMultTerm: number;
    redAddTerm: number;
    greenAddTerm: number;
    blueAddTerm: number;
    alphaAddTerm: number;
}

