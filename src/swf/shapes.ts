import { Bytes, Matrix } from '../utils/bytes';
import { SwfTagCode } from '../tags/tags';

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
    matrix?: Matrix; // Add matrix property for gradient fills
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
    noHScale?: boolean; // Added alias for noHScaleFlag
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

export interface MorphShape {
    startShape: any;
    endShape: any;
    bounds: {
        start: { xMin: number; xMax: number; yMin: number; yMax: number };
        end: { xMin: number; xMax: number; yMin: number; yMax: number };
    };
}

export function parseShape(data: Bytes, shapeVersion: number): Shape {
    const bounds = data.readRect();

    // Para DefineShape4, ler edge bounds e use fill winding rule
    if (shapeVersion === SwfTagCode.DefineShape4) {
        data.readRect(); // edgeBounds (unused)
        data.readUint8(); // usesFillWindingRule (unused)
    }

    const fillStyles = parseFillStyles(data, shapeVersion);
    const lineStyles = parseLineStyles(data, shapeVersion);
    const records = parseShapeRecords(data);

    return {
        bounds,
        fillStyles,
        lineStyles,
        records
    };
}

function parseFillStyles(data: Bytes, shapeVersion: number): FillStyle[] {
    const fillStyles: FillStyle[] = [];
    
    // Check if we have enough data to read the fill style count
    if (data.eof) {
        console.warn('[SWF] No data available for fill styles');
        return fillStyles;
    }
    
    let fillStyleCount = data.readUint8();

    if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        if (data.remaining < 2) {
            console.warn('[SWF] Insufficient data for extended fill style count');
            return fillStyles;
        }
        fillStyleCount = data.readUint16();
    }

    for (let i = 0; i < fillStyleCount; i++) {
        if (data.eof) {
            console.warn(`[SWF] No data available for fill style ${i + 1}/${fillStyleCount}`);
            break;
        }
        
        const fillType = data.readUint8();
        const fillStyle: FillStyle = { type: fillType };

        switch (fillType) {
            case 0x00: // Solid fill
                const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
                if (data.remaining < colorBytes) {
                    console.warn(`[SWF] Insufficient data for solid fill color in fill style ${i + 1}`);
                    fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Magenta for debug
                } else {
                    fillStyle.color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
                }
                break;

            case 0x10: // Linear gradient
            case 0x12: // Radial gradient
            case 0x13: // Focal radial gradient (SWF 8+)
                // Check if we have enough data for matrix and gradient
                if (data.remaining < 10) { // Rough estimate for minimum matrix + gradient data
                    console.warn(`[SWF] Insufficient data for gradient fill in fill style ${i + 1}`);
                    fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Fallback to magenta
                    break;
                }
                try {
                    fillStyle.bitmapMatrix = data.readMatrix();
                    fillStyle.gradient = parseGradient(data, fillType, shapeVersion);
                } catch (error) {
                    console.warn(`[SWF] Error parsing gradient in fill style ${i + 1}:`, error);
                    fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Fallback to magenta
                }
                break;

            case 0x40: // Repeating bitmap
            case 0x41: // Clipped bitmap
            case 0x42: // Non-smoothed repeating bitmap
            case 0x43: // Non-smoothed clipped bitmap
                if (data.remaining < 12) { // 2 bytes for bitmap ID + minimum matrix data
                    console.warn(`[SWF] Insufficient data for bitmap fill in fill style ${i + 1}`);
                    fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Fallback to magenta
                    break;
                }
                try {
                    fillStyle.bitmapId = data.readUint16();
                    fillStyle.bitmapMatrix = data.readMatrix();
                } catch (error) {
                    console.warn(`[SWF] Error parsing bitmap fill in fill style ${i + 1}:`, error);
                    fillStyle.color = { r: 1, g: 0, b: 1, a: 1 }; // Fallback to magenta
                }
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
    
    // Check if we have enough data to read the line style count
    if (data.eof) {
        console.warn('[SWF] No data available for line styles');
        return lineStyles;
    }
    
    let lineStyleCount = data.readUint8();

    if (lineStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        if (data.remaining < 2) {
            console.warn('[SWF] Insufficient data for extended line style count');
            return lineStyles;
        }
        lineStyleCount = data.readUint16();
    }

    for (let i = 0; i < lineStyleCount; i++) {
        // Check if we have enough data for width
        if (data.remaining < 2) {
            console.warn(`[SWF] Insufficient data for line style ${i + 1}/${lineStyleCount}`);
            break;
        }
        
        const width = data.readUint16();

        if (shapeVersion === SwfTagCode.DefineShape4) {
            // Check if we have enough data for LineStyle2 structure
            // We need at least 2 bytes for the flags and cap styles
            if (data.remaining < 2) {
                console.warn(`[SWF] Insufficient data for LineStyle2 ${i + 1}/${lineStyleCount}`);
                break;
            }
            
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
                if (data.remaining < 2) {
                    console.warn(`[SWF] Insufficient data for miter limit factor in line style ${i + 1}`);
                    break;
                }
                miterLimitFactor = data.readFixed8();
            }

            let color: Color;
            let fillType: FillStyle | undefined = undefined;

            if (hasFillFlag) {
                // Check if we have enough data for fill styles
                if (data.eof) {
                    console.warn(`[SWF] No data available for fill styles in line style ${i + 1}`);
                    color = { r: 0, g: 0, b: 0, a: 1 };
                } else {
                    const fillStyles = parseFillStyles(data, shapeVersion);
                    fillType = fillStyles.length > 0 ? fillStyles[0] : undefined;
                    color = (fillType && fillType.color) ? fillType.color : { r: 0, g: 0, b: 0, a: 1 };
                }
            } else {
                if (data.remaining < 4) {
                    console.warn(`[SWF] Insufficient data for color in line style ${i + 1}`);
                    color = { r: 0, g: 0, b: 0, a: 1 };
                } else {
                    color = readColor(data, true);
                }
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
            // Check if we have enough data for color
            const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
            if (data.remaining < colorBytes) {
                console.warn(`[SWF] Insufficient data for color in line style ${i + 1}`);
                break;
            }
            
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

function parseShapeRecords(data: Bytes): ShapeRecord[] {
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

export function parseMorphShape(bytes: Bytes): MorphShape {
    const startBounds = bytes.readRect();
    const endBounds = bytes.readRect();
    
    // Use DefineShape3 for morph shapes
    const startShape = parseShape(bytes, SwfTagCode.DefineShape3);
    const endShape = parseShape(bytes, SwfTagCode.DefineShape3);
    
    return {
        startShape,
        endShape,
        bounds: {
            start: startBounds,
            end: endBounds
        }
    };
}

function readColor(data: Bytes, hasAlpha: boolean): Color {
    const r = data.readUint8() / 255;
    const g = data.readUint8() / 255;
    const b = data.readUint8() / 255;
    const a = hasAlpha ? data.readUint8() / 255 : 1;

    return { r, g, b, a };
}
