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

    // Ler tags com salvaguardas
    const tags: SwfTag[] = [];
    let lastPosition = bytes.position;
    let iterations = 0;

    while (!bytes.eof && bytes.remaining > 2) {
        iterations++;
        try {
            const tag = parseTag(bytes);
            tags.push(tag);

            // Progress log a cada 50 tags
            if (tags.length % 50 === 0) {
                console.log(`[SWF] Parsed ${tags.length} tags... position=${bytes.position} remaining=${bytes.remaining}`);
            }

            // Verificar fim
            if (tag.code === SwfTagCode.End) {
                console.log('[SWF] End tag encountered, stopping parse');
                break;
            }

            // Infinite loop safeguard: posição não avançou
            if (bytes.position === lastPosition) {
                console.warn('[SWF] Parser position did not advance. Aborting to prevent infinite loop.');
                break;
            }
            lastPosition = bytes.position;

            // Hard safety limit
            if (tags.length > 10000) {
                console.warn('[SWF] Tag count exceeded 10000. Aborting parse for safety.');
                break;
            }
        } catch (error) {
            console.warn('Erro ao parsear tag:', error);
            break;
        }
    }

    console.log(`[SWF] Total tags parsed: ${tags.length}`);
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
