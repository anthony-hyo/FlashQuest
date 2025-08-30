import pako from 'pako';

export interface SWFHeader {
    signature: string;
    version: number;
    fileLength: number;
    uncompressedLength: number;
}

export async function loadSwf(source:any) {
    let buffer;

    if (source instanceof File) {
        buffer = await source.arrayBuffer();
    } else if (typeof source === 'string') {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`Falha ao carregar SWF: ${response.statusText}`);
        buffer = await response.arrayBuffer();
    } else {
        throw new Error('Fonte inválida para SWF');
    }

    const rawData = new Uint8Array(buffer);
    const signature = String.fromCharCode(rawData[0], rawData[1], rawData[2]);
    const version = rawData[3];
    const fileLength = new DataView(buffer).getUint32(4, true);

    let swfBodyData;
    let uncompressedLength = fileLength;

    if (signature === 'CWS') {
        const compressedData = rawData.slice(8);
        swfBodyData = pako.inflate(compressedData);
    } else if (signature === 'FWS') {
        swfBodyData = rawData.slice(8);
    } else {
        throw new Error(`Assinatura SWF inválida: ${signature}`);
    }

    const header = { signature, version, fileLength, uncompressedLength };
    const dataView = new DataView(swfBodyData.buffer, swfBodyData.byteOffset, swfBodyData.byteLength);

    return { header: header, dataView };
}