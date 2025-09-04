import { Bytes, Matrix, ColorTransform } from '../utils/bytes';
import { SwfHeader, SwfTag, SwfTagCode } from '../tags/tags';

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface FillStyle {
    type: number;
    color?: Color;
    gradient?: Gradient;
    bitmapId?: number;
    bitmapMatrix?: Matrix;
}

export interface LineStyle {
    width: number;
    color: Color;
    startCapStyle?: number;
    joinStyle?: number;
    hasFillFlag?: boolean;
    noHScaleFlag?: boolean;
    noVScaleFlag?: boolean;
    pixelHintingFlag?: boolean;
    noClose?: boolean;
    endCapStyle?: number;
    miterLimitFactor?: number;
    fillType?: FillStyle;
}

export interface Gradient {
    spreadMode: number;
    interpolationMode: number;
    gradientRecords: GradientRecord[];
    focalPoint?: number;
}

export interface GradientRecord {
    ratio: number;
    color: Color;
}

export interface ShapeRecord {
    type: 'styleChange' | 'straightEdge' | 'curvedEdge';
    moveTo?: { x: number; y: number };
    lineTo?: { x: number; y: number };
    curveTo?: { controlX: number; controlY: number; anchorX: number; anchorY: number };
    fillStyle0?: number;
    fillStyle1?: number;
    lineStyle?: number;
    newStyles?: {
        fillStyles: FillStyle[];
        lineStyles: LineStyle[];
    };
}

export interface Shape {
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
    fillStyles: FillStyle[];
    lineStyles: LineStyle[];
    records: ShapeRecord[];
}

export function parseShape(data: Bytes, shapeVersion: number): Shape {
    const bounds = data.readRect();

    // Para DefineShape4, ler edge bounds e use fill winding rule
    if (shapeVersion === SwfTagCode.DefineShape4) {
        const edgeBounds = data.readRect();
        const usesFillWindingRule = data.readUint8() & 0x01;
    }

    const fillStyles = parseFillStyles(data, shapeVersion);
    const lineStyles = parseLineStyles(data, shapeVersion);
    const records = parseShapeRecords(data, fillStyles.length, lineStyles.length);

    return {
        bounds,
        fillStyles,
        lineStyles,
        records
    };
}

function parseFillStyles(data: Bytes, shapeVersion: number): FillStyle[] {
    const fillStyles: FillStyle[] = [];
    let fillStyleCount = data.readUint8();

    if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        fillStyleCount = data.readUint16();
    }

    for (let i = 0; i < fillStyleCount; i++) {
        const fillType = data.readUint8();
        const fillStyle: FillStyle = { type: fillType };

        switch (fillType) {
            case 0x00: // Solid fill
                fillStyle.color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
                break;

            case 0x10: // Linear gradient
            case 0x12: // Radial gradient
            case 0x13: // Focal radial gradient (SWF 8+)
                fillStyle.bitmapMatrix = data.readMatrix();
                fillStyle.gradient = parseGradient(data, fillType, shapeVersion);
                break;

            case 0x40: // Repeating bitmap
            case 0x41: // Clipped bitmap
            case 0x42: // Non-smoothed repeating bitmap
            case 0x43: // Non-smoothed clipped bitmap
                fillStyle.bitmapId = data.readUint16();
                fillStyle.bitmapMatrix = data.readMatrix();
                break;

            default:
                console.warn(`Tipo de fill desconhecido: ${fillType}`);
                fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Magenta para debug
                break;
        }

        fillStyles.push(fillStyle);
    }

    return fillStyles;
}

function parseLineStyles(data: Bytes, shapeVersion: number): LineStyle[] {
    const lineStyles: LineStyle[] = [];
    let lineStyleCount = data.readUint8();

    if (lineStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        lineStyleCount = data.readUint16();
    }

    for (let i = 0; i < lineStyleCount; i++) {
        const width = data.readUint16();

        if (shapeVersion === SwfTagCode.DefineShape4) {
            // LineStyle2 para DefineShape4
            const startCapStyle = data.readUnsignedBits(2);
            const joinStyle = data.readUnsignedBits(2);
            const hasFillFlag = data.readBit() === 1;
            const noHScaleFlag = data.readBit() === 1;
            const noVScaleFlag = data.readBit() === 1;
            const pixelHintingFlag = data.readBit() === 1;
            data.readUnsignedBits(5); // Reserved
            const noClose = data.readBit() === 1;
            const endCapStyle = data.readUnsignedBits(2);

            let miterLimitFactor;
            if (joinStyle === 2) {
                miterLimitFactor = data.readFixed8();
            }

            let color: Color;
            let fillType: FillStyle | undefined;

            if (hasFillFlag) {
                fillType = parseFillStyles(data, shapeVersion)[0];
                color = fillType.color || { r: 0, g: 0, b: 0, a: 1 };
            } else {
                color = readColor(data, true);
            }

            lineStyles.push({
                width,
                color,
                startCapStyle,
                joinStyle,
                hasFillFlag,
                noHScaleFlag,
                noVScaleFlag,
                pixelHintingFlag,
                noClose,
                endCapStyle,
                miterLimitFactor,
                fillType
            });
        } else {
            const color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
            lineStyles.push({ width, color });
        }
    }

    return lineStyles;
}

function parseGradient(data: Bytes, gradientType: number, shapeVersion: number): Gradient {
    const spreadMode = data.readUnsignedBits(2);
    const interpolationMode = data.readUnsignedBits(2);
    const numGradients = data.readUnsignedBits(4);

    const gradientRecords: GradientRecord[] = [];

    for (let i = 0; i < numGradients; i++) {
        const ratio = data.readUint8();
        const color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
        gradientRecords.push({ ratio, color });
    }

    let focalPoint;
    if (gradientType === 0x13) { // Focal radial gradient
        focalPoint = data.readFixed8();
    }

    return {
        spreadMode,
        interpolationMode,
        gradientRecords,
        focalPoint
    };
}

function parseShapeRecords(data: Bytes, numFillStyles: number, numLineStyles: number): ShapeRecord[] {
    const records: ShapeRecord[] = [];

    data.align();

    const numFillBits = data.readUnsignedBits(4);
    const numLineBits = data.readUnsignedBits(4);

    let currentX = 0;
    let currentY = 0;
    let fillBits = numFillBits;
    let lineBits = numLineBits;

    while (true) {
        const typeFlag = data.readBit();

        if (typeFlag === 0) {
            // Style change record
            const stateNewStyles = data.readBit();
            const stateLineStyle = data.readBit();
            const stateFillStyle1 = data.readBit();
            const stateFillStyle0 = data.readBit();
            const stateMoveTo = data.readBit();

            const record: ShapeRecord = { type: 'styleChange' };

            if (stateMoveTo) {
                const moveBits = data.readUnsignedBits(5);
                const deltaX = data.readSignedBits(moveBits);
                const deltaY = data.readSignedBits(moveBits);
                currentX = deltaX;
                currentY = deltaY;
                record.moveTo = { x: currentX, y: currentY };
            }

            if (stateFillStyle0) {
                record.fillStyle0 = data.readUnsignedBits(fillBits);
            }

            if (stateFillStyle1) {
                record.fillStyle1 = data.readUnsignedBits(fillBits);
            }

            if (stateLineStyle) {
                record.lineStyle = data.readUnsignedBits(lineBits);
            }

            if (stateNewStyles) {
                // Ler novos estilos
                const newFillStyles = parseFillStyles(data, SwfTagCode.DefineShape3);
                const newLineStyles = parseLineStyles(data, SwfTagCode.DefineShape3);

                record.newStyles = {
                    fillStyles: newFillStyles,
                    lineStyles: newLineStyles
                };

                data.align();
                fillBits = data.readUnsignedBits(4);
                lineBits = data.readUnsignedBits(4);
            }

            records.push(record);

            // Verificar fim dos registros
            if (!stateNewStyles && !stateLineStyle && !stateFillStyle1 && !stateFillStyle0 && !stateMoveTo) {
                break;
            }

        } else {
            // Edge record
            const straightFlag = data.readBit();

            if (straightFlag) {
                // Straight edge
                const numBits = data.readUnsignedBits(4) + 2;
                const generalLineFlag = data.readBit();

                let deltaX = 0, deltaY = 0;

                if (generalLineFlag) {
                    deltaX = data.readSignedBits(numBits);
                    deltaY = data.readSignedBits(numBits);
                } else {
                    const vertLineFlag = data.readBit();
                    if (vertLineFlag) {
                        deltaY = data.readSignedBits(numBits);
                    } else {
                        deltaX = data.readSignedBits(numBits);
                    }
                }

                currentX += deltaX;
                currentY += deltaY;

                records.push({
                    type: 'straightEdge',
                    lineTo: { x: currentX, y: currentY }
                });

            } else {
                // Curved edge
                const numBits = data.readUnsignedBits(4) + 2;
                const controlDeltaX = data.readSignedBits(numBits);
                const controlDeltaY = data.readSignedBits(numBits);
                const anchorDeltaX = data.readSignedBits(numBits);
                const anchorDeltaY = data.readSignedBits(numBits);

                const controlX = currentX + controlDeltaX;
                const controlY = currentY + controlDeltaY;
                const anchorX = controlX + anchorDeltaX;
                const anchorY = controlY + anchorDeltaY;

                currentX = anchorX;
                currentY = anchorY;

                records.push({
                    type: 'curvedEdge',
                    curveTo: {
                        controlX,
                        controlY,
                        anchorX,
                        anchorY
                    }
                });
            }
        }
    }

    return records;
}

function readColor(data: Bytes, hasAlpha: boolean): Color {
    const r = data.readUint8() / 255;
    const g = data.readUint8() / 255;
    const b = data.readUint8() / 255;
    const a = hasAlpha ? data.readUint8() / 255 : 1;

    return { r, g, b, a };
}
