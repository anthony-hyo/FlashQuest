import { SwfHeader, SwfTag, SwfTagCode } from '../tags/tags';
import { Bytes, ParserError } from '../utils/bytes';

// PERFORMANCE: Hardcoded constants without configuration options
// ISSUE: MAX_TAGS might be too restrictive for some SWF files
// MISSING: No justification for 50000 tag limit
const MAX_TAGS = 50000;
const MAX_TAG_LENGTH = 100 * 1024 * 1024; // 100MB per tag
const PROGRESS_LOG_INTERVAL = 100;

// TYPE SAFETY: Return type could be more specific about header properties
// MISSING: No validation of input DataView
export function parseSwf(dataView: DataView): { header: SwfHeader, tags: SwfTag[] } {
    const bytes = new Bytes(dataView.buffer);

    // Improved validation with better error positioning
    if (bytes.remaining < 3) {
        throw new ParserError('File too small to be a valid SWF', bytes.position);
    }
    
    // Efficient signature reading
    const signatureBytes = [bytes.readUint8(), bytes.readUint8(), bytes.readUint8()];
    const signature = String.fromCharCode(...signatureBytes);
    if (!['FWS', 'CWS', 'ZWS'].includes(signature)) {
        throw new ParserError(`Invalid SWF signature: ${signature}`, bytes.position - 3);
    }

    // ISSUE: Version range updated to 46 but still arbitrary
    // MISSING: Version-specific parsing logic
    const version = bytes.readUint8();
    if (version < 1 || version > 46) { // Adobe Flash version range
        console.warn(`[SWF] Unusual SWF version: ${version}`);
    }

    // ISSUE: File length validation only warns instead of failing
    // MISSING: Proper handling of compressed vs uncompressed length
    const fileLength = bytes.readUint32();
    if (fileLength !== dataView.byteLength) {
        console.warn(`[SWF] File length mismatch: header says ${fileLength}, actual ${dataView.byteLength}`);
    }

    // TYPE SAFETY: readRect(), readFixed8(), readUint16() could throw but not caught here
    // MISSING: Validation of frame data reasonableness
    const frameSize = bytes.readRect();
    const frameRate = bytes.readFixed8();
    const frameCount = bytes.readUint16();

    // TYPE SAFETY: SwfHeader interface might not match all properties
    const header: SwfHeader = {
        signature,
        version,
        fileLength,
        frameSize,
        frameRate,
        frameCount
    };

    // Pre-allocate tags array with reasonable initial capacity to reduce reallocations
    const tags: SwfTag[] = [];
    tags.length = 0; // Ensure it starts empty but with initial capacity
    
    let lastPosition = bytes.position;
    let stuckCount = 0;
    let nextProgressReport = PROGRESS_LOG_INTERVAL;

    // Improved end-of-file detection
    while (!bytes.eof && bytes.remaining >= 2) {
        try {
            const tag = parseTag(bytes);
            tags.push(tag);

            // Optimized progress reporting
            if (tags.length >= nextProgressReport) {
                console.log(`[SWF] Parsed ${tags.length} tags... position=${bytes.position} remaining=${bytes.remaining}`);
                nextProgressReport += PROGRESS_LOG_INTERVAL;
            }

            // Early termination for End tag
            if (tag.code === SwfTagCode.End) {
                console.log('[SWF] End tag encountered, stopping parse');
                break;
            }

            // Enhanced stuck detection
            if (bytes.position === lastPosition) {
                stuckCount++;
                if (stuckCount > 3) {
                    throw new ParserError('Parser position stuck, aborting to prevent infinite loop', bytes.position);
                }
            } else {
                stuckCount = 0;
                lastPosition = bytes.position;
            }

            // SECURITY: Good safety limit but might be too restrictive
            if (tags.length > MAX_TAGS) {
                throw new ParserError(`Tag count exceeded ${MAX_TAGS}, aborting for safety`, bytes.position);
            }
        } catch (error) {
            // TYPE SAFETY: Error type checking is basic
            if (error instanceof ParserError) {
                throw error;
            }
            console.error(`[SWF] Error parsing tag at position ${bytes.position}:`, error);
            // ISSUE: Skip strategy is too simplistic - only skips 1 byte
            // MISSING: Intelligent recovery mechanisms
            if (bytes.remaining > 0) {
                bytes.skip(Math.min(1, bytes.remaining));
            }
            break;
        }
    }

    console.log(`[SWF] Total tags parsed: ${tags.length}`);
    return { header, tags };
}

// MISSING: Input validation for bytes parameter
// TYPE SAFETY: Return type could be more specific
function parseTag(bytes: Bytes): SwfTag {
    // ISSUE: Hardcoded 2-byte minimum check
    if (bytes.remaining < 2) {
        throw new ParserError('Insufficient data for tag header', bytes.position);
    }
    
    // TYPE SAFETY: Bit operations assume 16-bit value
    const tagCodeAndLength = bytes.readUint16();
    const code = (tagCodeAndLength >> 6);
    let length = tagCodeAndLength & 0x3F;

    // ISSUE: Unknown tag codes only generate warnings, not errors
    // MISSING: Proper enum validation
    if (!Object.values(SwfTagCode).includes(code as SwfTagCode)) {
        console.warn(`[SWF] Unknown tag code: ${code}`);
    }

    // ISSUE: Extended length validation could be more robust
    if (length === 0x3F) {
        if (bytes.remaining < 4) {
            throw new ParserError('Insufficient data for extended tag length', bytes.position);
        }
        length = bytes.readUint32();
    }

    // ISSUE: Length < 0 check is unnecessary for unsigned integers
    // TYPE SAFETY: readUint32() returns unsigned value, can't be negative
    if (length < 0) {
        throw new ParserError(`Invalid tag length: ${length}`, bytes.position);
    }
    
    // SECURITY: Good size validation
    if (length > MAX_TAG_LENGTH) {
        throw new ParserError(`Tag length too large: ${length} bytes (max ${MAX_TAG_LENGTH})`, bytes.position);
    }
    
    // ISSUE: Should handle partial tag data more gracefully
    if (length > bytes.remaining) {
        throw new ParserError(`Tag length ${length} exceeds remaining data ${bytes.remaining}`, bytes.position);
    }

    // PERFORMANCE: readBytes creates new ArrayBuffer copy
    // MISSING: Option to read tag data lazily
    const tagData = bytes.readBytes(length);

    // TYPE SAFETY: SwfTag interface might not be complete
    return {
        code: code as SwfTagCode,
        length,
        data: tagData
    };
}

// ISSUE: Re-exporting types that are already imported
export { SwfHeader, SwfTag, SwfTagCode };
