import {SWFFileHeader, SwfHeader, SwfTag, SwfTagCode} from '../tags/tags';

export async function loadSwf(source: string | File): Promise<{ header: SWFFileHeader, dataView: DataView }> {
    let arrayBuffer: ArrayBuffer;

    if (typeof source === 'string') {
        // Carregar de URL
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Falha ao carregar SWF: ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
    } else {
        // Carregar de File
        arrayBuffer = await source.arrayBuffer();
    }

    const dataView = new DataView(arrayBuffer);

    // Ler cabeçalho do arquivo
    const signature = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2)
    );

    const compressed = signature === 'CWS';
    const version = dataView.getUint8(3);
    const fileLength = dataView.getUint32(4, true);

    if (signature !== 'FWS' && signature !== 'CWS') {
        throw new Error('Arquivo não é um SWF válido');
    }

    let decompressedData: DataView;

    if (compressed) {
        // Descomprimir usando zlib/deflate
        const compressedData = new Uint8Array(arrayBuffer, 8);
        const decompressed = await decompressZlib(compressedData);

        // Criar novo buffer com cabeçalho não comprimido + dados descomprimidos
        const fullBuffer = new ArrayBuffer(8 + decompressed.length);
        const fullView = new DataView(fullBuffer);

        // Copiar cabeçalho (8 bytes)
        for (let i = 0; i < 8; i++) {
            fullView.setUint8(i, dataView.getUint8(i));
        }

        // Alterar assinatura para FWS
        fullView.setUint8(0, 0x46); // 'F'

        // Copiar dados descomprimidos
        const fullArray = new Uint8Array(fullBuffer);
        fullArray.set(decompressed, 8);

        decompressedData = new DataView(fullBuffer);
    } else {
        decompressedData = dataView;
    }

    const header: SWFFileHeader = {
        signature,
        version,
        fileLength,
        compressed
    };

    return { header, dataView: decompressedData };
}

async function decompressZlib(compressedData: Uint8Array): Promise<Uint8Array> {
    // Usar CompressionStream API se disponível
    if ('CompressionStream' in window) {
        try {
            const stream = new DecompressionStream('deflate');
            const writer = stream.writable.getWriter();
            const reader = stream.readable.getReader();

            writer.write(new Uint8Array(compressedData));
            writer.close();

            const chunks: Uint8Array[] = [];
            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    chunks.push(value);
                }
            }

            // Combinar chunks
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;

            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        } catch (error) {
            console.warn('Falha na descompressão nativa, usando fallback:', error);
        }
    }

    // Fallback: implementação simples de inflate
    return inflateSimple(compressedData);
}

function inflateSimple(data: Uint8Array): Uint8Array {
    // Implementação muito básica de inflate
    // Para uma implementação completa, seria necessário usar uma biblioteca como pako.js

    // Por enquanto, apenas retorna os dados como estão
    // Em um cenário real, você deveria usar uma biblioteca de descompressão
    console.warn('Usando descompressão simplificada - pode não funcionar com todos os arquivos SWF');

    // Tentar pular cabeçalho zlib (2 bytes) e checksum (4 bytes no final)
    if (data.length > 6) {
        return data.slice(2, -4);
    }

    return data;
}

