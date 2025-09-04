import {SWFFileHeader, SwfHeader, SwfTag, SwfTagCode} from '../tags/tags';

// Try to import pako if available
let pako: any = null;
try {
    // Dynamic import for pako since it might not be available
    if (typeof window !== 'undefined') {
        pako = (window as any).pako;
    } else {
        // For Node.js/Bun environment
        pako = require('pako');
    }
} catch (error) {
    console.warn('Pako library not available, will use fallback decompression');
}

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
    // Usar CompressionStream API se disponível (checar ambiente com segurança)
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const stream = new DecompressionStream('deflate');
            const writer = stream.writable.getWriter();
            const reader = stream.readable.getReader();

            const properArray = new Uint8Array(compressedData);
            await writer.write(properArray);
            await writer.close();

            const chunks: Uint8Array[] = [];
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) chunks.push(value);
            }

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

    // Fallback: usar pako.js se disponível, senão implementação simples
    if (pako) {
        try {
            return pako.inflate(compressedData);
        } catch (error) {
            console.warn('Falha na descompressão com pako.js:', error);
        }
    }

    // Último fallback: implementação muito básica
    return inflateSimple(compressedData);
}

function inflateSimple(data: Uint8Array): Uint8Array {
    // Implementação muito básica de inflate
    // Para uma implementação completa, seria necessário usar uma biblioteca como pako.js
    
    console.warn('Usando descompressão simplificada - pode não funcionar com todos os arquivos SWF');
    
    // Tentar detectar e pular cabeçalho zlib/deflate
    let startOffset = 0;
    let endOffset = data.length;

    // Cabeçalho zlib típico
    if (data.length >= 2) {
        const header = (data[0] << 8) | data[1];
        // Verificar se é um cabeçalho zlib válido
        if ((header & 0x0F00) === 0x0800 && (header % 31) === 0) {
            startOffset = 2; // Pular cabeçalho zlib
            endOffset = data.length - 4; // Remover checksum Adler-32
        }
    }

    // Para arquivos não muito complexos, os dados podem estar em formato simples
    // Esta é uma implementação muito limitada
    const result = data.slice(startOffset, endOffset);
    
    // Tentar expandir dados se parecem estar comprimidos
    if (result.length < data.length * 0.1) {
        // Se resultado é muito pequeno, provavelmente falhou
        console.warn('Descompressão pode ter falhado - considerando usar biblioteca externa');
        return data; // Retornar dados originais
    }
    
    return result;
}
