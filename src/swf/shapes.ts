import { Bytes, Matrix } from '../utils/bytes';
import { SwfTagCode } from '../tags/tags';

export interface Color {
    r: number; // ISSUE: Range not specified - should be 0-255 or 0-1?
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
    // MISSING: Additional gradient types from newer SWF versions
}

export interface FillStyle {
    type: FillStyleType;
    color?: NormalizedColor;
    gradient?: Gradient;
    bitmapId?: number;
    bitmapMatrix?: Matrix;
    matrix?: Matrix; // Add matrix property for gradient fills
    repeating?: boolean; // For bitmap fills
    // MISSING: Focus ratio for focal gradients
    // MISSING: Interpolation mode for gradients
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
    // Clamp ratio to valid range [0,1]
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const oneMinusRatio = 1 - clampedRatio;
    
    return {
        r: end.r * clampedRatio + start.r * oneMinusRatio,
        g: end.g * clampedRatio + start.g * oneMinusRatio,
        b: end.b * clampedRatio + start.b * oneMinusRatio,
        a: end.a * clampedRatio + start.a * oneMinusRatio
    };
}

export function colorToHex(color: NormalizedColor): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Enhanced Shape interface to include parsed flags
export interface Shape {
    bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
    edgeBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
    fillStyles: FillStyle[];
    lineStyles: LineStyle[];
    records: ShapeRecord[];
    usesFillWindingRule?: boolean;
    usesNonScalingStrokes?: boolean;
    usesScalingStrokes?: boolean;
}

export function parseShape(data: Bytes, shapeVersion: number): Shape {
    console.log(`[SWF] Parsing shape, version: ${shapeVersion}, starting position: ${data.position}`);
    
    const bounds = data.readRect();
    console.log(`[SWF] Bounds read, position after bounds: ${data.position}`);
    
    let edgeBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | undefined;
    let usesFillWindingRule: boolean | undefined;
    let usesNonScalingStrokes: boolean | undefined;
    let usesScalingStrokes: boolean | undefined;
    
    // ISSUE: Shape version validation logic has alignment problems for DefineShape4
    // CRITICAL BUG: Data alignment issues cause misreading of fill style arrays
    if (shapeVersion === SwfTagCode.DefineShape4) {
        try {
            // EdgeBounds (RECT)
            edgeBounds = data.readRect();
            console.log(`[SWF] EdgeBounds read, position: ${data.position}`);
            
            // Flags: UB[5] reserved, UB[1] UsesFillWindingRule, UB[1] UsesNonScalingStrokes, UB[1] UsesScalingStrokes
            const flags = data.readUint8(); // Read all 8 bits at once for easier debugging
            usesFillWindingRule = (flags & 0x04) !== 0; // bit 2
            usesNonScalingStrokes = (flags & 0x02) !== 0; // bit 1  
            usesScalingStrokes = (flags & 0x01) !== 0; // bit 0
            
            console.log(`[SWF] Flags: 0x${flags.toString(16)}, position: ${data.position}`);
            
        } catch (error) {
            console.error('Error parsing DefineShape4 flags:', error);
            data.align(); // Try to recover
        }
    } else if (shapeVersion >= SwfTagCode.DefineShape && shapeVersion <= SwfTagCode.DefineShape3) {
        // Other shape versions: align before arrays
        data.align();
    } else {
        throw new Error(`Unsupported shape version: ${shapeVersion}`);
    }

    console.log(`[SWF] About to parse fill styles, position: ${data.position}, remaining: ${data.remaining}`);
    const fillStyles = parseFillStyles(data, shapeVersion);
    console.log(`[SWF] Fill styles parsed: ${fillStyles.length}, position: ${data.position}`);
    
    const lineStyles = parseLineStyles(data, shapeVersion);
    console.log(`[SWF] Line styles parsed: ${lineStyles.length}, position: ${data.position}`);
    
    const records = parseShapeRecords(data);
    console.log(`[SWF] Shape records parsed: ${records.length}, position: ${data.position}`);

    return {
        bounds,
        edgeBounds,
        fillStyles,
        lineStyles,
        records,
        usesFillWindingRule,
        usesNonScalingStrokes,
        usesScalingStrokes
    };
}

// Constants for configuration
const MAX_FILL_STYLES = 20; // Reasonable limit for typical SWF files
const COLOR_RECOVERY_SCAN_LIMIT = 50;

function parseFillStyles(data: Bytes, shapeVersion: number): FillStyle[] {
    const fillStyles: FillStyle[] = [];
    
    // Check if we have enough data to read the fill style count
    if (data.eof) {
        console.warn('[SWF] No data available for fill styles');
        return fillStyles;
    }
    
    console.log(`[SWF] Reading fill style count at position ${data.position}`);
    let fillStyleCount = data.readUint8();
    console.log(`[SWF] Initial fill style count: ${fillStyleCount}`);

    if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
        if (data.remaining < 2) {
            console.warn('[SWF] Insufficient data for extended fill style count');
            return fillStyles;
        }
        fillStyleCount = data.readUint16();
        console.log(`[SWF] Extended fill style count: ${fillStyleCount}`);
    }
    
    // Safety check for unreasonable fill style counts
    if (fillStyleCount > MAX_FILL_STYLES) {
        console.warn(`[SWF] Suspiciously high fill style count: ${fillStyleCount}, possibly corrupted data. Attempting recovery...`);
        
        // For DefineShape4, this often indicates the data stream is misaligned
        // Try to recover by scanning for more reasonable values
        console.log(`[SWF] Attempting recovery scan from position ${data.position - 1}`);
        data.position = data.position - 1; // Go back to re-read
        
        // Scan forward looking for a reasonable fill style count (0-10)
        for (let i = 0; i < 20 && !data.eof; i++) {
            const testCount = data.readUint8();
            console.log(`[SWF] Recovery scan position ${data.position - 1}: count = ${testCount}`);
            
            if (testCount <= 10) { // Reasonable fill style count
                console.log(`[SWF] Recovery found reasonable count: ${testCount} at position ${data.position - 1}`);
                fillStyleCount = testCount;
                break;
            }
        }
        
        // If still unreasonable, just use 0 (no fill styles)
        if (fillStyleCount > MAX_FILL_STYLES) {
            console.warn('[SWF] Recovery failed, using 0 fill styles');
            fillStyleCount = 0;
        }
    }

    console.log(`[SWF] Parsing ${fillStyleCount} fill styles starting at position ${data.position}`);
    
    for (let i = 0; i < fillStyleCount; i++) {
        if (data.eof) {
            console.warn(`[SWF] No data available for fill style ${i + 1}/${fillStyleCount}`);
            break;
        }
        
        const fillType = data.readUint8();
        
        // Validate fill type before casting
        if (!Object.values(FillStyleType).includes(fillType)) {
            console.warn(`[SWF] Invalid fill type: ${fillType}, using solid fallback`);
            fillStyles.push({
                type: FillStyleType.Solid,
                color: createNormalizedColor(1, 0, 0, 1) // Red fallback
            });
            continue;
        }
        
        try {
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
        const originalPosition = data.position;
        data.position = startPos;
        const rawBytes: number[] = [];
        const scanLimit = Math.min(COLOR_RECOVERY_SCAN_LIMIT, data.remaining);
        
        // Read bytes efficiently in chunks
        for (let i = 0; i < scanLimit; i++) {
            if (data.eof) break;
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
            // Ensure we don't access out-of-bounds indices
            for (let i = 0; i <= rawBytes.length - 3; i++) {
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
        
        // Restore original position after recovery attempt
        data.position = originalPosition;
        
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

// Constants for line styles
const MAX_LINE_STYLES = 500;

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
    
    // Safety check for unreasonable line style counts
    if (lineStyleCount > MAX_LINE_STYLES) {
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

// Constants for shape record parsing
const MAX_SHAPE_RECORDS = 10000;

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
    let loopDetector = new Set<string>();

    while (true && recordCount < MAX_SHAPE_RECORDS) {
        if (data.eof || data.remaining < 1) {
            console.warn('[SWF] No more data for shape records, stopping');
            break;
        }
        
        // Detect infinite loops by tracking position
        const positionKey = `${data.position}:${recordCount}`;
        if (loopDetector.has(positionKey)) {
            console.error('[SWF] Infinite loop detected in shape records parsing');
            break;
        }
        loopDetector.add(positionKey);
        
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
                // Validate coordinate bounds to prevent overflow
                const deltaX = data.readSignedBits(moveBits);
                const deltaY = data.readSignedBits(moveBits);
                
                // Clamp coordinates to reasonable bounds
                const MAX_COORD = 1000000; // 1 million twips
                currentX = Math.max(-MAX_COORD, Math.min(MAX_COORD, deltaX));
                currentY = Math.max(-MAX_COORD, Math.min(MAX_COORD, deltaY));
                record.moveTo = { x: currentX, y: currentY };
            }

            if (stateFillStyle0) {
                if (fillBits > 0) {
                    record.fillStyle0 = data.readUnsignedBits(fillBits);
                } else {
                    record.fillStyle0 = 0;
                }
            }

            if (stateFillStyle1) {
                if (fillBits > 0) {
                    record.fillStyle1 = data.readUnsignedBits(fillBits);
                } else {
                    record.fillStyle1 = 0;
                }
            }

            if (stateLineStyle) {
                if (lineBits > 0) {
                    record.lineStyle = data.readUnsignedBits(lineBits);
                } else {
                    record.lineStyle = 0;
                }
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
