import {SWFFileHeader} from '../tags/tags';
import * as pako from 'pako';

export async function loadSwf(source: string | File): Promise<{ header: SWFFileHeader, dataView: DataView }> {
    console.time('[SWF] Total load');
    let arrayBuffer: ArrayBuffer;

    if (typeof source === 'string') {
        console.time('[SWF] Fetch');
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Falha ao carregar SWF: ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
        console.timeEnd('[SWF] Fetch');
    } else {
        console.time('[SWF] File->ArrayBuffer');
        arrayBuffer = await source.arrayBuffer();
        console.timeEnd('[SWF] File->ArrayBuffer');
    }

    console.log('[SWF] Raw size bytes:', arrayBuffer.byteLength);
    const dataView = new DataView(arrayBuffer);

    const signature = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2)
    );

    const compressed = signature === 'CWS';
    const version = dataView.getUint8(3);
    const fileLength = dataView.getUint32(4, true);

    console.log('[SWF] Header:', { signature, compressed, version, declaredLength: fileLength });

    if (signature !== 'FWS' && signature !== 'CWS') {
        throw new Error('Arquivo não é um SWF válido');
    }

    let decompressedData: DataView;

    if (compressed) {
        console.time('[SWF] Decompress');
        const compressedData = new Uint8Array(arrayBuffer, 8);
        console.log('[SWF] Compressed payload length (excluding 8-byte header):', compressedData.length);
        try {
            const decompressed = await decompressZlib(compressedData);
            console.timeEnd('[SWF] Decompress');
            console.log('[SWF] Decompressed length:', decompressed.length);
            if (decompressed.length === compressedData.length) {
                console.warn('[SWF] Decompressed size equals compressed size - possibly failed decompression');
            }
            const fullBuffer = new ArrayBuffer(8 + decompressed.length);
            const fullView = new DataView(fullBuffer);
            for (let i = 0; i < 8; i++) fullView.setUint8(i, dataView.getUint8(i));
            fullView.setUint8(0, 0x46); // 'F'
            new Uint8Array(fullBuffer).set(decompressed, 8);
            decompressedData = new DataView(fullBuffer);
        } catch (err) {
            console.timeEnd('[SWF] Decompress');
            console.error('[SWF] Decompress failed, aborting with raw data (likely to fail later):', err);
            decompressedData = dataView;
        }
    } else {
        decompressedData = dataView;
    }

    const header: SWFFileHeader = { signature, version, fileLength, compressed };
    console.timeEnd('[SWF] Total load');
    return { header, dataView: decompressedData };
}

async function decompressZlib(compressedData: Uint8Array): Promise<Uint8Array> {
    console.log('[SWF] Compressed bytes:', compressedData.length, 'First bytes:', [...compressedData.slice(0, 6)]);

    // 1. Try pako first (most reliable & synchronous)
    try {
        console.time('[SWF] pako.inflate');
        const out = pako.inflate(compressedData);
        console.timeEnd('[SWF] pako.inflate');
        return out;
    } catch (e) {
        console.warn('[SWF] pako inflate falhou, tentando alternativas:', e);
    }

    // 2. Try native DecompressionStream with timeout safeguard
    if (typeof DecompressionStream !== 'undefined') {
        try {
            console.time('[SWF] DecompressionStream');
            const result = await decompressWithStream(compressedData, 8000);
            console.timeEnd('[SWF] DecompressionStream');
            return result;
        } catch (e) {
            console.warn('[SWF] DecompressionStream falhou:', e);
        }
    }

    // 3. Fallback very naive
    console.warn('[SWF] Usando fallback inflate simples (menos confiável)');
    return inflateSimple(compressedData);
}

async function decompressWithStream(data: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout na descompressão nativa')), timeoutMs);
        try {
            const stream = new DecompressionStream('deflate');
            const writer = stream.writable.getWriter();
            // Ensure we provide an ArrayBuffer (not potentially SharedArrayBuffer / ArrayBufferLike)
            const buffer = new ArrayBuffer(data.byteLength);
            new Uint8Array(buffer).set(data);
            await writer.write(buffer); // BufferSource acceptable
            await writer.close();
            const reader = stream.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) chunks.push(value);
            }
            const total = chunks.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(total);
            let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
            clearTimeout(timer);
            resolve(out);
        } catch (err) {
            clearTimeout(timer);
            reject(err);
        }
    });
}

function inflateSimple(data: Uint8Array): Uint8Array {
    console.warn('[SWF] inflateSimple chamado — resultado pode ser inválido');
    let startOffset = 0; let endOffset = data.length;
    if (data.length >= 2) {
        const header = (data[0] << 8) | data[1];
        if ((header & 0x0F00) === 0x0800 && (header % 31) === 0) {
            startOffset = 2; endOffset = data.length - 4;
        }
    }
    const result = data.slice(startOffset, endOffset);
    if (result.length < data.length * 0.1) {
        console.warn('[SWF] Resultado suspeito (muito pequeno), retornando dados originais');
        return data;
    }
    return result;
}
