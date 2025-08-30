// bytes.ts
export class Bytes {

    readonly dataView: DataView;
    position: number = 0;
    bitPosition: number = 0;
    
    constructor(buffer: ArrayBufferLike) {
        this.dataView = new DataView(buffer);
    }

    readUint8(): number {
        const value = this.dataView.getUint8(this.position);
        this.position += 1;
        return value;
    }

    readUint16(): number {
        const value = this.dataView.getUint16(this.position, true);
        this.position += 2;
        return value;
    }

    readInt16(): number {
        const value = this.dataView.getInt16(this.position, true);
        this.position += 2;
        return value;
    }

    readUint32(): number {
        const value = this.dataView.getUint32(this.position, true);
        this.position += 4;
        return value;
    }

    readFixed(): number {
        const value = this.dataView.getInt32(this.position, true) / 65536.0;
        this.position += 4;
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
        let num = 0;
        for (let i = n - 1; i >= 0; i--) {
            if (this.readBit()) {
                num |= (1 << i);
            }
        }
        if (num & (1 << (n - 1))) {
            num -= (1 << n);
        }
        return num;
    }

    readBit(): number {
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

    skip(length: number) {
        this.position += length;
    }

    readBytes(length: number): Bytes {
        const bytes = new Bytes(this.dataView.buffer.slice(this.position, this.position + length));
        this.position += length;
        return bytes;
    }
}
