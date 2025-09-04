import { SwfHeader, SwfTag, SwfTagCode } from '../tags/tags';
import { Bytes } from '../utils/bytes';

export function parseSwf(dataView: DataView): { header: SwfHeader, tags: SwfTag[] } {
    const bytes = new Bytes(dataView.buffer);

    // Pular cabeçalho do arquivo (8 bytes)
    bytes.skip(8);

    // Ler cabeçalho SWF
    const frameSize = bytes.readRect();
    const frameRate = bytes.readFixed8();
    const frameCount = bytes.readUint16();

    const header: SwfHeader = {
        frameSize,
        frameRate,
        frameCount
    };

    // Ler tags
    const tags: SwfTag[] = [];

    while (!bytes.eof && bytes.remaining > 2) {
        try {
            const tag = parseTag(bytes);
            tags.push(tag);

            if (tag.code === SwfTagCode.End) {
                break;
            }
        } catch (error) {
            console.warn('Erro ao parsear tag:', error);
            break;
        }
    }

    return { header, tags };
}

function parseTag(bytes: Bytes): SwfTag {
    const tagCodeAndLength = bytes.readUint16();
    const code = (tagCodeAndLength >> 6) as SwfTagCode;
    let length = tagCodeAndLength & 0x3F;

    // Se length é 0x3F, ler length longo
    if (length === 0x3F) {
        length = bytes.readUint32();
    }

    // Ler dados da tag
    const tagData = bytes.readBytes(length);

    return {
        code,
        length,
        data: tagData
    };
}

export { SwfHeader, SwfTag, SwfTagCode };

