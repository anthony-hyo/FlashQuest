import { Bytes, Matrix } from '../utils/bytes';
import { SwfTagCode } from '../tags/tags';

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface NormalizedColor {
    r: number; // 0-1
    g: number; // 0-1
    b: number; // 0-1
    a: number; // 0-1
}

export enum FillStyleType {
    Solid = 0x00,
    LinearGradient = 0x10,
    RadialGradient = 0x12,
    FocalGradient = 0x13,
    RepeatingBitmap = 0x40,
    ClippedBitmap = 0x41,
    NonSmoothedRepeatingBitmap = 0x42,
    NonSmoothedClippedBitmap = 0x43
}

export interface FillStyle {
    type: FillStyleType;
    color?: NormalizedColor;
    gradient?: Gradient;
    bitmapId?: number;
    bitmapMatrix?: Matrix;
    matrix?: Matrix; // Add matrix property for gradient fills
    repeating?: boolean; // For bitmap fills
}

export interface LineStyle {
    width: number;
    color: NormalizedColor;
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
    color: NormalizedColor;
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

// Utility functions for color handling
export function createNormalizedColor(r: number, g: number, b: number, a: number = 1): NormalizedColor {
    return { r, g, b, a };
}

export function lerpColor(start: NormalizedColor, end: NormalizedColor, ratio: number): NormalizedColor {
    // BUG: No input validation - ratio should be clamped to [0,1] range
    // PERFORMANCE: Could be optimized by caching 1-ratio calculation
    return {
        r: end.r * ratio + start.r * (1 - ratio),
        g: end.g * ratio + start.g * (1 - ratio),
        b: end.b * ratio + start.b * (1 - ratio),
        a: end.a * ratio + start.a * (1 - ratio)
    };
}

export function colorToHex(color: NormalizedColor): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function parseShape(data: Bytes, shapeVersion: number): Shape {
    const bounds = data.readRect();
    
    // LOGIC ERROR: shapeVersion comparison uses enum values inconsistently - should validate enum type
    // MISSING: Error handling for corrupt shape version values
    // Para DefineShape4, ler edge bounds e flags corretamente (bit a bit)
    if (shapeVersion === SwfTagCode.DefineShape4) {
        // EdgeBounds (RECT)
        const edgeBounds = data.readRect();
        // Flags: UB[5] reserved, UB[1] UsesFillWindingRule, UB[1] UsesNonScalingStrokes, UB[1] UsesScalingStrokes
        // Ler bit a bit para não desalinha o stream
        data.readUnsignedBits(5); // reserved
        const usesFillWindingRule = data.readBit();
        const usesNonScalingStrokes = data.readBit();
        const usesScalingStrokes = data.readBit();
        // Alinhar para o próximo byte antes de ler arrays
        data.align();
        void edgeBounds; void usesFillWindingRule; void usesNonScalingStrokes; void usesScalingStrokes;
        // MISSING: These parsed flags are read but never used - should be stored in Shape interface
    } else {
        // INCOMPLETE: Other shape versions may have different parsing requirements not handled here
        // Outros formatos: alinhar antes dos arrays
        data.align();
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

    // LOGIC ERROR: This condition is dangerous - should check data.remaining before reading uint16
    if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        if (data.remaining < 2) {
            console.warn('[SWF] Insufficient data for extended fill style count');
            return fillStyles;
        }
        fillStyleCount = data.readUint16();
    }
    
    // Safety check for unreasonable fill style counts
    // MAGIC NUMBER: 100 is arbitrary - should be configurable constant
    if (fillStyleCount > 100) {
        console.warn(`[SWF] Suspiciously high fill style count: ${fillStyleCount}, possibly corrupted data. Attempting recovery...`);
        return attemptColorRecovery(data, shapeVersion);
    }

    for (let i = 0; i < fillStyleCount; i++) {
        if (data.eof) {
            console.warn(`[SWF] No data available for fill style ${i + 1}/${fillStyleCount}`);
            break;
        }
        
        const fillType = data.readUint8();
        
        try {
            // TYPE SAFETY ISSUE: fillType cast to FillStyleType without validation
            const fillStyle = parseSingleFillStyle(data, fillType as FillStyleType, shapeVersion);
            fillStyles.push(fillStyle);
        } catch (error) {
            console.error(`[SWF] Error parsing fill style ${i + 1}: ${error}`);
            // Add a fallback solid color
            fillStyles.push({
                type: FillStyleType.Solid,
                color: createNormalizedColor(1, 0, 0, 1) // Red fallback
            });
            break; // Stop parsing to prevent further corruption
        }
    }

    return fillStyles;
}

function attemptColorRecovery(data: Bytes, shapeVersion: number): FillStyle[] {
    // Try to find valid color data by scanning for typical color patterns
    const startPos = data.position - 1;
    console.log(`[SWF] Attempting color recovery from position ${startPos}`);
    
    try {
        data.position = startPos;
        const rawBytes: number[] = [];
        // MAGIC NUMBER: 30 byte scan limit is arbitrary
        // PERFORMANCE ISSUE: Reading bytes one by one in a loop
        for (let i = 0; i < Math.min(30, data.remaining); i++) {
            rawBytes.push(data.readUint8());
        }
        console.log(`[SWF] Raw bytes: ${rawBytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        
        // Look for SWF fill style patterns
        let recoveredColor: NormalizedColor | null = null;
        
        // LOGIC ERROR: This loop may access out-of-bounds indices (i+3)
        for (let i = 0; i < rawBytes.length - 4; i++) {
            if (rawBytes[i] === FillStyleType.Solid) {
                // Found solid fill type marker
                const r = rawBytes[i + 1] / 255;
                const g = rawBytes[i + 2] / 255; 
                const b = rawBytes[i + 3] / 255;
                const color = createNormalizedColor(r, g, b, 1);
                console.log(`[SWF] Recovered solid fill: RGB(${rawBytes[i + 1]}, ${rawBytes[i + 2]}, ${rawBytes[i + 3]}) = ${JSON.stringify(color)}`);
                recoveredColor = color;
                break;
            }
        }
        
        // If no marker found, look for reasonable RGB sequences
        if (!recoveredColor) {
            console.log(`[SWF] No fill type marker found, analyzing RGB patterns:`);
            // LOGIC ERROR: This loop may access out-of-bounds indices (i+2)
            for (let i = 0; i < rawBytes.length - 2; i++) {
                const r = rawBytes[i] / 255;
                const g = rawBytes[i + 1] / 255;
                const b = rawBytes[i + 2] / 255;
                
                // Skip unlikely color patterns
                if (isValidColorPattern(r, g, b)) {
                    recoveredColor = createNormalizedColor(r, g, b, 1);
                    console.log(`[SWF] Recovered RGB pattern: RGB(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`);
                    break;
                }
            }
        }
        
        // MISSING: data.position is not restored after recovery attempt
        return [{
            type: FillStyleType.Solid,
            color: recoveredColor || createNormalizedColor(1, 0, 0, 1) // Red fallback
        }];
    } catch (e) {
        console.error(`[SWF] Error during color recovery: ${e}`);
        return [{
            type: FillStyleType.Solid,
            color: createNormalizedColor(1, 0, 0, 1) // Red fallback
        }];
    }
}

function isValidColorPattern(r: number, g: number, b: number): boolean {
    // Skip patterns that are likely not colors
    if (r === g && g === b && (r < 0.04 || r > 0.96)) return false; // Very dark or bright uniform
    if (r === 0 && g === 0 && b === 0) return false; // Pure black
    if (r === 1 && g === 1 && b === 1) return false; // Pure white
    return r > 0.02 || g > 0.02 || b > 0.02; // At least some color
}

function parseSingleFillStyle(data: Bytes, fillType: FillStyleType, shapeVersion: number): FillStyle {
    const fillStyle: FillStyle = { type: fillType };

    switch (fillType) {
        case FillStyleType.Solid:
            const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
            if (data.remaining < colorBytes) {
                throw new Error(`Insufficient data for solid fill color`);
            }
            fillStyle.color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
            break;

        case FillStyleType.LinearGradient:
        case FillStyleType.RadialGradient:
        case FillStyleType.FocalGradient:
            fillStyle.matrix = data.readMatrix();
            fillStyle.gradient = parseGradient(data, fillType, shapeVersion);
            break;

        case FillStyleType.RepeatingBitmap:
        case FillStyleType.NonSmoothedRepeatingBitmap:
            fillStyle.repeating = true;
            fillStyle.bitmapId = data.readUint16();
            fillStyle.bitmapMatrix = data.readMatrix();
            break;
            
        case FillStyleType.ClippedBitmap:
        case FillStyleType.NonSmoothedClippedBitmap:
            fillStyle.repeating = false;
            fillStyle.bitmapId = data.readUint16();
            fillStyle.bitmapMatrix = data.readMatrix();
            break;

        default:
            throw new Error(`Unknown fill type: 0x${(fillType as number).toString(16)}`);
    }

    return fillStyle;
}

function parseLineStyles(data: Bytes, shapeVersion: number): LineStyle[] {
    const lineStyles: LineStyle[] = [];
    
    // Check if we have enough data to read the line style count
    if (data.eof) {
        console.warn('[SWF] No data available for line styles');
        return lineStyles;
    }
    
    let lineStyleCount = data.readUint8();

    // LOGIC ERROR: Same issue as fillStyles - should check data.remaining before reading uint16
    if (lineStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        if (data.remaining < 2) {
            console.warn('[SWF] Insufficient data for extended line style count');
            return lineStyles;
        }
        lineStyleCount = data.readUint16();
    }
    
    // Safety check for unreasonable line style counts
    // MAGIC NUMBER: 50 is arbitrary - should be configurable constant
    if (lineStyleCount > 50) {
        console.warn(`[SWF] Suspiciously high line style count: ${lineStyleCount}, possibly corrupted data. Skipping line styles.`);
        return lineStyles;
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
            // LOGIC ERROR: Magic number 2 for joinStyle should be constant MITER_JOIN
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
                    // PERFORMANCE ISSUE: Parsing full fill styles array but only using first one
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

    if (data.remaining < 1) {
        console.warn('[SWF] No data remaining for shape records');
        return records;
    }

    const numFillBits = data.readUnsignedBits(4);
    const numLineBits = data.readUnsignedBits(4);
    
    console.log('[SWF] Shape records - numFillBits:', numFillBits, 'numLineBits:', numLineBits, 'remaining data:', data.remaining);

    let currentX = 0;
    let currentY = 0;
    let fillBits = numFillBits;
    let lineBits = numLineBits;
    
    let recordCount = 0;

    // MAGIC NUMBER: 100 record limit is arbitrary and could truncate valid data
    // MISSING: No checks for infinite loops caused by corrupted bit data
    while (true && recordCount < 100) { // Add safety limit
        if (data.eof || data.remaining < 1) {
            console.warn('[SWF] No more data for shape records, stopping');
            break;
        }
        
        recordCount++;
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
                // PERFORMANCE ISSUE: No bounds checking on coordinate values
                const deltaX = data.readSignedBits(moveBits);
                const deltaY = data.readSignedBits(moveBits);
                currentX = deltaX;
                currentY = deltaY;
                record.moveTo = { x: currentX, y: currentY };
            }

            if (stateFillStyle0) {
                // BUG: fillBits could be 0, causing readUnsignedBits(0) which may behave unexpectedly
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
            console.log('[SWF] Added style change record:', record);

            // Verificar fim dos registros
            if (!stateNewStyles && !stateLineStyle && !stateFillStyle1 && !stateFillStyle0 && !stateMoveTo) {
                console.log('[SWF] End of shape records detected');
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

                const straightRecord = {
                    type: 'straightEdge' as const,
                    lineTo: { x: currentX, y: currentY }
                };
                records.push(straightRecord);
                console.log('[SWF] Added straight edge record:', straightRecord);

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

                const curvedRecord = {
                    type: 'curvedEdge' as const,
                    curveTo: {
                        controlX,
                        controlY,
                        anchorX,
                        anchorY
                    }
                };
                records.push(curvedRecord);
                console.log('[SWF] Added curved edge record:', curvedRecord);
            }
        }
    }

    console.log('[SWF] Shape records parsing complete. Total records:', records.length);
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

function readColor(data: Bytes, hasAlpha: boolean): NormalizedColor {
    const r = data.readUint8() / 255;
    const g = data.readUint8() / 255;
    const b = data.readUint8() / 255;
    const a = hasAlpha ? data.readUint8() / 255 : 1;

    return createNormalizedColor(r, g, b, a);
}
