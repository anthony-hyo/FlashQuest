import {SWFFileHeader} from '../tags/tags';
import * as pako from 'pako';

// TYPE SAFETY: Function signature should be more specific about what DataView contains
// MISSING: No input validation for source parameter
// MISSING: No error recovery mechanisms for partial failures
export async function loadSwf(source: string | File): Promise<{ header: SWFFileHeader, dataView: DataView }> {
    console.time('[SWF] Total load');
    let arrayBuffer: ArrayBuffer;

    if (typeof source === 'string') {
        console.time('[SWF] Fetch');
        // SECURITY: Basic URL validation but no domain restriction
        // MISSING: No CORS handling configuration
        try {
            new URL(source);
        } catch {
            throw new Error('Invalid URL format');
        }
        
        // MISSING: No timeout configuration for fetch
        // MISSING: No retry logic for network failures
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to load SWF: ${response.statusText}`);
        }
        
        // TYPE SAFETY: Content type check is too permissive
        // MISSING: More specific SWF MIME type validation
        const contentType = response.headers.get('content-type');
        if (contentType && !contentType.includes('application/x-shockwave-flash') && !contentType.includes('application/octet-stream')) {
            console.warn('Unexpected content type:', contentType);
        }
        
        // PERFORMANCE: File size check after download starts
        // ISSUE: Should check content-length before downloading
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) { // 100MB limit
            throw new Error('File too large (>100MB)');
        }
        
        // PERFORMANCE: No streaming for large files
        arrayBuffer = await response.arrayBuffer();
        console.timeEnd('[SWF] Fetch');
    } else {
        console.time('[SWF] File->ArrayBuffer');
        // MISSING: No file type validation beyond extension
        if (source.size > 100 * 1024 * 1024) { // 100MB limit
            throw new Error('File too large (>100MB)');
        }
        
        // TYPE SAFETY: File name might be null
        // ISSUE: Extension check is case-sensitive only after toLowerCase()
        if (source.name && !source.name.toLowerCase().endsWith('.swf')) {
            console.warn('File does not have .swf extension:', source.name);
        }
        
        // PERFORMANCE: Loads entire file into memory at once
        arrayBuffer = await source.arrayBuffer();
        console.timeEnd('[SWF] File->ArrayBuffer');
    }

    console.log('[SWF] Raw size bytes:', arrayBuffer.byteLength);
    
    // SECURITY: Minimum size check is good but arbitrary
    if (arrayBuffer.byteLength < 8) {
        throw new Error('File too small to be a valid SWF (minimum 8 bytes)');
    }
    
    const dataView = new DataView(arrayBuffer);
    // PERFORMANCE: String.fromCharCode creates new strings each time
    // TYPE SAFETY: No validation that getUint8 won't throw
    const signature = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2)
    );

    const compressed = signature === 'CWS';
    const version = dataView.getUint8(3);
    const fileLength = dataView.getUint32(4, true);

    console.log('[SWF] Header:', { signature, compressed, version, declaredLength: fileLength });

    // ISSUE: ZWS signature is checked but not supported
    // MISSING: More detailed signature validation
    if (signature !== 'FWS' && signature !== 'CWS' && signature !== 'ZWS') {
        throw new Error('Invalid SWF file signature');
    }

    // ISSUE: Version range is arbitrary and may be outdated
    // MISSING: Version-specific feature support checking
    if (version < 1 || version > 40) {
        console.warn('Unusual SWF version:', version);
    }

    // ISSUE: File length validation only warns, doesn't fail
    // MISSING: Proper handling of length mismatches
    if (fileLength !== arrayBuffer.byteLength && !compressed) {
        console.warn('File length mismatch:', { declared: fileLength, actual: arrayBuffer.byteLength });
    }

    let decompressedData: DataView;

    if (compressed || signature === 'ZWS') {
        // MISSING: ZWS (LZMA) support claimed but not implemented
        if (signature === 'ZWS') {
            throw new Error('LZMA compressed SWF (ZWS) not yet supported');
        }
        
        console.time('[SWF] Decompress');
        // ISSUE: Redundant check - already validated above
        if (arrayBuffer.byteLength <= 8) {
            throw new Error('Compressed SWF too small to contain payload');
        }
        
        // PERFORMANCE: Creates new Uint8Array view instead of using existing dataView
        const compressedData = new Uint8Array(arrayBuffer, 8);
        console.log('[SWF] Compressed payload length (excluding 8-byte header):', compressedData.length);
        
        try {
            const decompressed = await decompressZlib(compressedData);
            console.timeEnd('[SWF] Decompress');
            console.log('[SWF] Decompressed length:', decompressed.length);
            
            // ISSUE: Empty decompression result should be more specific error
            if (decompressed.length === 0) {
                throw new Error('Decompression resulted in empty data');
            }
            
            // ISSUE: Arbitrary threshold of 1000 bytes difference
            // MISSING: Proper validation of decompressed size
            const expectedDecompressedSize = fileLength - 8;
            if (Math.abs(decompressed.length - expectedDecompressedSize) > 1000) {
                console.warn('Decompressed size differs significantly from expected:', {
                    decompressed: decompressed.length,
                    expected: expectedDecompressedSize
                });
            }
            
            // PERFORMANCE: Multiple buffer copies instead of single allocation
            // Memory allocations could be optimized
            const fullBuffer = new ArrayBuffer(8 + decompressed.length);
            const headerView = new Uint8Array(fullBuffer, 0, 8);
            const payloadView = new Uint8Array(fullBuffer, 8);
            
            // Copy header (convert CWS to FWS)
            headerView.set(new Uint8Array(arrayBuffer, 0, 8));
            headerView[0] = 0x46; // 'F'
            
            // Copy decompressed payload
            payloadView.set(decompressed);
            
            decompressedData = new DataView(fullBuffer);
        } catch (err) {
            console.timeEnd('[SWF] Decompress');
            console.error('[SWF] Decompression failed:', err);
            // TYPE SAFETY: Error message construction could be improved
            throw new Error(`Failed to decompress SWF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    } else {
        decompressedData = dataView;
    }

    // TYPE SAFETY: SWFFileHeader interface might be incomplete
    const header: SWFFileHeader = { signature, version, fileLength, compressed };
    console.timeEnd('[SWF] Total load');
    return { header, dataView: decompressedData };
}

// PERFORMANCE: Hardcoded timeout value
// MISSING: Configuration options for timeout
const DECOMPRESS_TIMEOUT_MS = 10000; // 10 seconds

// MISSING: Proper error types for different failure modes
// TYPE SAFETY: Return type should be more specific
async function decompressZlib(compressedData: Uint8Array): Promise<Uint8Array> {
    console.log('[SWF] Compressed bytes:', compressedData.length, 'First bytes:', [...compressedData.slice(0, 6)]);

    // ISSUE: Pako fallback strategy is flawed - should be primary method
    // PERFORMANCE: Multiple decompression attempts waste CPU
    try {
        console.time('[SWF] pako.inflate');
        const out = pako.inflate(compressedData);
        console.timeEnd('[SWF] pako.inflate');
        return out;
    } catch (e) {
        console.warn('[SWF] pako inflate failed, trying alternatives:', e);
    }

    // TYPE SAFETY: DecompressionStream availability check is runtime only
    // MISSING: Feature detection for other browsers
    if (typeof DecompressionStream !== 'undefined') {
        try {
            console.time('[SWF] DecompressionStream');
            const result = await decompressWithStream(compressedData, DECOMPRESS_TIMEOUT_MS);
            console.timeEnd('[SWF] DecompressionStream');
            return result;
        } catch (e) {
            console.warn('[SWF] DecompressionStream failed:', e);
        }
    }

    // ISSUE: Should provide more specific error about what methods were tried
    throw new Error('All decompression methods failed');
}

// MISSING: Input validation and error handling
// PERFORMANCE: Chunk size is hardcoded
async function decompressWithStream(data: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    // PERFORMANCE: Hardcoded chunk size without justification
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks for memory efficiency
    
    // SECURITY: Good memory safety check
    // ISSUE: Arbitrary 100MB limit
    if (data.length > 100 * 1024 * 1024) { // 100MB limit
        throw new Error(`Input data too large: ${data.length} bytes`);
    }

    // PERFORMANCE: AbortController for timeout is good practice
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, timeoutMs);

    try {
        // TYPE SAFETY: DecompressionStream constructor could throw
        const stream = new DecompressionStream('deflate');
        const writer = stream.writable.getWriter();
        
        // PERFORMANCE: Unnecessary buffer copy for SharedArrayBuffer safety
        // ISSUE: Comment mentions SharedArrayBuffer but doesn't properly detect it
        const buffer = new ArrayBuffer(data.byteLength);
        new Uint8Array(buffer).set(data);
        
        await writer.write(buffer);
        await writer.close();
        
        const reader = stream.readable.getReader();
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        
        // PERFORMANCE: Synchronous abort check in async loop
        // ISSUE: No backpressure handling for large streams
        while (true) {
            if (abortController.signal.aborted) {
                throw new Error(`Decompression timeout after ${timeoutMs}ms`);
            }

            const { value, done } = await reader.read();
            if (done) break;
            
            if (value) {
                chunks.push(value);
                totalLength += value.length;

                // SECURITY: Good additional memory check
                // ISSUE: 500MB limit is arbitrary
                if (totalLength > 500 * 1024 * 1024) { // 500MB decompressed limit
                    throw new Error(`Decompressed data too large: ${totalLength} bytes`);
                }
            }
        }
        
        // PERFORMANCE: Efficient concatenation approach
        // Could be optimized further with single allocation
        const out = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        
        return out;
    } finally {
        // ISSUE: clearTimeout should be called even on success
        clearTimeout(timeoutId);
    }
}


