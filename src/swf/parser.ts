import { SwfHeader, SwfTag, SwfTagCode } from '../tags/tags';
import { Bytes } from '../utils/bytes';

export function parseSwf(dataView: DataView): { header: SwfHeader, tags: SwfTag[] } {
    const bytes = new Bytes(dataView.buffer);

    // MISSING: No SWF signature validation (FWS/CWS/ZWS magic bytes)
    // MISSING: No version check - different versions have different structures
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
    let iterations = 0; // UNUSED VARIABLE: iterations is incremented but never checked

    while (!bytes.eof && bytes.remaining > 2) {
        iterations++;
        try {
            const tag = parseTag(bytes);
            tags.push(tag);

            // Progress log a cada 50 tags
            // PERFORMANCE ISSUE: Logging every 50 tags in production builds
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

            // MAGIC NUMBER: 10000 is arbitrary limit
            // Hard safety limit
            if (tags.length > 10000) {
                console.warn('[SWF] Tag count exceeded 10000. Aborting parse for safety.');
                break;
            }
        } catch (error) {
            // BUG: Generic error handling loses important context about which tag failed
            console.warn('Erro ao parsear tag:', error);
            break;
        }
    }

    console.log(`[SWF] Total tags parsed: ${tags.length}`);
    return { header, tags };
}

function parseTag(bytes: Bytes): SwfTag {
    // MISSING: Bounds check - should verify at least 2 bytes available
    const tagCodeAndLength = bytes.readUint16();
    const code = (tagCodeAndLength >> 6) as SwfTagCode; // TYPE SAFETY: No validation of enum value
    let length = tagCodeAndLength & 0x3F;

    // Se length é 0x3F, ler length longo
    if (length === 0x3F) {
        // MISSING: Bounds check - should verify 4 bytes available for uint32
        length = bytes.readUint32();
    }

    // MISSING: Validation - length could be negative or exceed remaining data
    // MISSING: Maximum length check to prevent memory exhaustion
    // Ler dados da tag
    const tagData = bytes.readBytes(length);

    return {
        code,
        length,
        data: tagData
    };
}

export { SwfHeader, SwfTag, SwfTagCode };
