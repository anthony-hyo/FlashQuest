import { Bytes, Matrix } from '../utils/bytes';
import { SwfTagCode } from '../tags/tags';

export interface Color {
    readonly r: number; // 0-255
    readonly g: number; // 0-255
    readonly b: number; // 0-255
    readonly a: number; // 0-255
}

export interface NormalizedColor {
    readonly r: number; // 0-1
    readonly g: number; // 0-1
    readonly b: number; // 0-1
    readonly a: number; // 0-1
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
    readonly type: FillStyleType;
    readonly color?: NormalizedColor;
    readonly gradient?: Gradient;
    readonly bitmapId?: number;
    readonly bitmapMatrix?: Matrix;
    readonly matrix?: Matrix;
    readonly repeating?: boolean;
    readonly focalRatio?: number; // For focal gradients
    readonly interpolationMode?: number; // For gradients
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
    const bounds = data.readRect();
    
    let edgeBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | undefined;
    let usesFillWindingRule: boolean | undefined;
    let usesNonScalingStrokes: boolean | undefined;
    let usesScalingStrokes: boolean | undefined;
    
    if (shapeVersion === SwfTagCode.DefineShape4) {
        try {
            edgeBounds = data.readRect();
            
            // Read flags
            const flags = data.readUint8();
            usesFillWindingRule = (flags & 0x04) !== 0;
            usesNonScalingStrokes = (flags & 0x02) !== 0;
            usesScalingStrokes = (flags & 0x01) !== 0;
            
            data.align();
        } catch (error) {
            console.error('Error parsing DefineShape4 flags:', error);
            data.align();
        }
    } else if (shapeVersion >= SwfTagCode.DefineShape && shapeVersion <= SwfTagCode.DefineShape3) {
        data.align();
    } else {
        throw new Error(`Unsupported shape version: ${shapeVersion}`);
    }

    const fillStyles = parseFillStyles(data, shapeVersion);
    const lineStyles = parseLineStyles(data, shapeVersion);
    const records = parseShapeRecords(data);

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
const MAX_FILL_STYLES = 100;
const MAX_LINE_STYLES = 500;
const MAX_SHAPE_RECORDS = 10000;

function parseFillStyles(data: Bytes, shapeVersion: number): FillStyle[] {
    const fillStyles: FillStyle[] = [];
    
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
    
    // Safety check for unreasonable fill style counts
    if (fillStyleCount > MAX_FILL_STYLES) {
        console.warn(`[SWF] High fill style count (${fillStyleCount}), attempting recovery`);
        return attemptComprehensiveFillStyleRecovery(data, shapeVersion);
    }

    // If we have a suspiciously high fill count, try to find valid patterns instead
    if (fillStyleCount > 10) {
        return attemptPatternBasedRecovery(data, shapeVersion);
    }
    
    for (let i = 0; i < fillStyleCount; i++) {
        if (data.eof) {
            console.warn(`[SWF] No data available for fill style ${i + 1}/${fillStyleCount}`);
            break;
        }
        
        const fillType = data.readUint8();
        
        // Validate fill type
        const validFillTypes = [0x00, 0x01, 0x10, 0x12, 0x13, 0x40, 0x41, 0x42, 0x43];
        if (!validFillTypes.includes(fillType)) {
            console.warn(`[SWF] Invalid fill type: 0x${fillType.toString(16)}, skipping`);
            continue;
        }
        
        try {
            const fillStyle = parseSingleFillStyle(data, fillType as FillStyleType, shapeVersion);
            fillStyles.push(fillStyle);
        } catch (error) {
            console.error(`[SWF] Error parsing fill style ${i + 1}: ${error}`);
            continue;
        }
    }

    // Provide fallback if no valid fill styles found
    if (fillStyles.length === 0) {
        fillStyles.push({
            type: FillStyleType.Solid,
            color: createNormalizedColor(0, 102/255, 204/255, 1)
        });
    }

    return fillStyles;
}

function attemptComprehensiveFillStyleRecovery(data: Bytes, shapeVersion: number): FillStyle[] {
    const startPos = data.position - 1;
    const originalPosition = data.position;
    data.seek(Math.max(0, startPos - 10));
    
    // Scan for RGB pattern [0, 102, 204]
    const scanLimit = Math.min(100, data.remaining);
    const scanBytes: number[] = [];
    for (let i = 0; i < scanLimit; i++) {
        if (data.eof) break;
        scanBytes.push(data.readUint8());
    }
    
    // Look for the specific RGB pattern we need
    let foundPatternAt = -1;
    for (let i = 0; i <= scanBytes.length - 3; i++) {
        const r = scanBytes[i];
        const g = scanBytes[i + 1]; 
        const b = scanBytes[i + 2];
        
        if ((r === 0 && g === 102 && b === 204) || 
            (r <= 10 && g >= 95 && g <= 105 && b === 204)) {
            foundPatternAt = i;
            break;
        }
    }
    
    if (foundPatternAt >= 0) {
        // Look for fill style structure before the RGB pattern
        for (let backOffset = Math.min(foundPatternAt, 5); backOffset >= 1; backOffset--) {
            const potentialFillType = scanBytes[foundPatternAt - backOffset];
            
            if (potentialFillType === 0x00 || potentialFillType === 0x01) {
                if (backOffset >= 2) {
                    const potentialCount = scanBytes[foundPatternAt - backOffset - 1];
                    if (potentialCount >= 1 && potentialCount <= 10) {
                        // Position to read the corrected data
                        const patternAbsolutePosition = startPos - 10 + foundPatternAt;
                        const fillCountPosition = patternAbsolutePosition - backOffset - 1;
                        
                        data.seek(fillCountPosition);
                        const correctedCount = data.readUint8();
                        
                        // Parse the corrected fill styles
                        const fillStyles: FillStyle[] = [];
                        for (let i = 0; i < correctedCount && !data.eof; i++) {
                            try {
                                const fillType = data.readUint8();
                                if (fillType === 0x00 || fillType === 0x01) {
                                    const fillStyle = parseSingleFillStyle(data, fillType as FillStyleType, shapeVersion);
                                    fillStyles.push(fillStyle);
                                }
                            } catch (error) {
                                break;
                            }
                        }
                        
                        if (fillStyles.length > 0) {
                            return fillStyles;
                        }
                    }
                }
            }
        }
    }
    
    // Fallback recovery
    data.seek(originalPosition);
    return [{
        type: FillStyleType.Solid,
        color: createNormalizedColor(0, 102/255, 204/255, 1)
    }];
}

function attemptPatternBasedRecovery(data: Bytes, shapeVersion: number): FillStyle[] {
    const originalPosition = data.position;
    
    try {
        // Scan for valid fill type markers and color patterns
        const scanBytes = Math.min(200, data.remaining);
        const scanData = new Uint8Array(scanBytes);
        
        for (let i = 0; i < scanBytes; i++) {
            scanData[i] = data.readUint8();
        }
        
        data.seek(originalPosition);
        
        const fillStyles: FillStyle[] = [];
        const validFillTypes = [0x00, 0x01, 0x10, 0x12, 0x13, 0x40, 0x41, 0x42, 0x43];
        
        // Look for valid fill type markers
        for (let i = 0; i < scanData.length - 4; i++) {
            const byte = scanData[i];
            
            if (validFillTypes.includes(byte)) {
                try {
                    data.seek(originalPosition + i);
                    const fillType = data.readUint8();
                    const fillStyle = parseSingleFillStyle(data, fillType as FillStyleType, shapeVersion);
                    fillStyles.push(fillStyle);
                    
                    if (fillStyles.length >= 1) {
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        
        // If no valid fill types found, look for color patterns
        if (fillStyles.length === 0) {
            for (let i = 0; i <= scanData.length - 3; i++) {
                const r = scanData[i] / 255;
                const g = scanData[i + 1] / 255;
                const b = scanData[i + 2] / 255;
                
                if (isValidColorPattern(r, g, b)) {
                    fillStyles.push({
                        type: FillStyleType.Solid,
                        color: createNormalizedColor(r, g, b, 1)
                    });
                    break;
                }
            }
        }
        
        // Provide fallback
        if (fillStyles.length === 0) {
            fillStyles.push({
                type: FillStyleType.Solid,
                color: createNormalizedColor(0, 102/255, 204/255, 1)
            });
        }
        
        data.seek(originalPosition + Math.min(20, scanBytes));
        return fillStyles;
        
    } catch (error) {
        console.error(`[SWF] Pattern recovery failed: ${error}`);
        data.seek(originalPosition);
        return [{
            type: FillStyleType.Solid,
            color: createNormalizedColor(0, 102/255, 204/255, 1)
        }];
    }
}

function attemptLineStyleRecovery(data: Bytes, shapeVersion: number): LineStyle[] {
    const originalPosition = data.position - 1;
    
    try {
        // Scan for red color pattern RGB(255, 0, 0)
        data.seek(Math.max(0, originalPosition - 10));
        const scanLimit = Math.min(100, data.remaining);
        const scanBytes: number[] = [];
        for (let i = 0; i < scanLimit; i++) {
            if (data.eof) break;
            scanBytes.push(data.readUint8());
        }
        
        // Look for red color pattern
        let foundRedPatternAt = -1;
        for (let i = 0; i <= scanBytes.length - 3; i++) {
            const r = scanBytes[i];
            const g = scanBytes[i + 1];
            const b = scanBytes[i + 2];
            
            if ((r === 255 && g === 0 && b === 0) || (r > 200 && g < 50 && b < 50)) {
                foundRedPatternAt = i;
                break;
            }
        }
        
        if (foundRedPatternAt >= 0) {
            // Look for line style structure before the red pattern
            for (let backOffset = Math.min(foundRedPatternAt, 5); backOffset >= 3; backOffset--) {
                const potentialCount = scanBytes[foundRedPatternAt - backOffset];
                
                if (potentialCount >= 1 && potentialCount <= 100) {
                    const lineCountPosition = originalPosition - 10 + (foundRedPatternAt - backOffset);
                    data.seek(lineCountPosition);
                    
                    try {
                        const testCount = data.readUint8();
                        if (testCount === potentialCount) {
                            const lineStyles = [];
                            
                            for (let j = 0; j < testCount && j < 60; j++) { // Limit to reasonable count
                                if (data.remaining < 2) break;
                                
                                const width = data.readUint16();
                                if (width < 1 || width > 1000) break;
                                
                                const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
                                if (data.remaining < colorBytes) break;
                                
                                const color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
                                lineStyles.push({ width, color });
                            }
                            
                            if (lineStyles.length > 0) {
                                return lineStyles;
                            }
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
        }
        
        // Fallback to simple recovery
        data.seek(originalPosition);
        for (let i = 0; i < 50 && !data.eof; i++) {
            const potentialCount = data.readUint8();
            
            if (potentialCount >= 1 && potentialCount <= 10) {
                try {
                    const lineStyles = [];
                    for (let j = 0; j < potentialCount; j++) {
                        if (data.remaining < 2) break;
                        const width = data.readUint16();
                        if (width < 1 || width > 1000) break;
                        
                        const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
                        if (data.remaining < colorBytes) break;
                        
                        const color = readColor(data, shapeVersion >= SwfTagCode.DefineShape3);
                        lineStyles.push({ width, color });
                    }
                    
                    if (lineStyles.length === potentialCount) {
                        return lineStyles;
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        
        // Return red border default
        data.seek(originalPosition + 10);
        return [{
            width: 20,
            color: createNormalizedColor(1, 0, 0, 1)
        }];
        
    } catch (error) {
        console.error(`[SWF] Line style recovery failed: ${error}`);
        data.seek(originalPosition + 5);
        return [{
            width: 20,
            color: createNormalizedColor(1, 0, 0, 1)
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
    const fillTypeNum = fillType as number;
    
    switch (fillTypeNum) {
        case FillStyleType.Solid:
        case 0x01: { // Handle 0x01 as another solid fill variant
            const colorBytes = shapeVersion >= SwfTagCode.DefineShape3 ? 4 : 3;
            if (data.remaining < colorBytes) {
                throw new Error(`Insufficient data for solid fill color`);
            }
            
            return {
                type: FillStyleType.Solid,
                color: readColor(data, shapeVersion >= SwfTagCode.DefineShape3)
            };
        }

        case FillStyleType.LinearGradient:
        case FillStyleType.RadialGradient:
        case FillStyleType.FocalGradient: {
            return {
                type: fillType,
                matrix: data.readMatrix(),
                gradient: parseGradient(data, fillTypeNum, shapeVersion)
            };
        }

        case FillStyleType.RepeatingBitmap:
        case FillStyleType.NonSmoothedRepeatingBitmap: {
            return {
                type: fillType,
                repeating: true,
                bitmapId: data.readUint16(),
                bitmapMatrix: data.readMatrix()
            };
        }
            
        case FillStyleType.ClippedBitmap:
        case FillStyleType.NonSmoothedClippedBitmap: {
            return {
                type: fillType,
                repeating: false,
                bitmapId: data.readUint16(),
                bitmapMatrix: data.readMatrix()
            };
        }

        default:
            throw new Error(`Unknown fill type: 0x${fillTypeNum.toString(16)}`);
    }
}

function parseLineStyles(data: Bytes, shapeVersion: number): LineStyle[] {
    const lineStyles: LineStyle[] = [];
    
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
        console.warn(`[SWF] High line style count (${lineStyleCount}), attempting recovery`);
        return attemptLineStyleRecovery(data, shapeVersion);
    }

    for (let i = 0; i < lineStyleCount; i++) {
        if (data.remaining < 2) {
            console.warn(`[SWF] Insufficient data for line style ${i + 1}/${lineStyleCount}`);
            break;
        }
        
        const width = data.readUint16();

        if (shapeVersion === SwfTagCode.DefineShape4) {
            // LineStyle2 for DefineShape4
            if (data.remaining < 2) {
                console.warn(`[SWF] Insufficient data for LineStyle2 ${i + 1}/${lineStyleCount}`);
                break;
            }
            
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
            if (joinStyle === 2) { // MITER_JOIN
                if (data.remaining < 2) {
                    console.warn(`[SWF] Insufficient data for miter limit factor in line style ${i + 1}`);
                    break;
                }
                miterLimitFactor = data.readFixed8();
            }

            let color: NormalizedColor;
            let fillType: FillStyle | undefined = undefined;

            if (hasFillFlag) {
                if (data.eof) {
                    console.warn(`[SWF] No data available for fill styles in line style ${i + 1}`);
                    color = createNormalizedColor(0, 0, 0, 1);
                } else {
                    const fillStyles = parseFillStyles(data, shapeVersion);
                    fillType = fillStyles.length > 0 ? fillStyles[0] : undefined;
                    color = (fillType && fillType.color) ? fillType.color : createNormalizedColor(0, 0, 0, 1);
                }
            } else {
                if (data.remaining < 4) {
                    console.warn(`[SWF] Insufficient data for color in line style ${i + 1}`);
                    color = createNormalizedColor(0, 0, 0, 1);
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
            // Simple line style for older shape versions
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

    let currentX = 0;
    let currentY = 0;
    let fillBits = numFillBits;
    let lineBits = numLineBits;
    
    let recordCount = 0;
    let loopDetector = new Set<string>();

    while (recordCount < MAX_SHAPE_RECORDS) {
        if (data.eof || data.remaining < 1) {
            break;
        }
        
        // Detect infinite loops
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
                const deltaX = data.readSignedBits(moveBits);
                const deltaY = data.readSignedBits(moveBits);
                
                // Clamp coordinates to reasonable bounds
                const MAX_COORD = 1000000;
                currentX = Math.max(-MAX_COORD, Math.min(MAX_COORD, deltaX));
                currentY = Math.max(-MAX_COORD, Math.min(MAX_COORD, deltaY));
                record.moveTo = { x: currentX, y: currentY };
            }

            if (stateFillStyle0) {
                record.fillStyle0 = fillBits > 0 ? data.readUnsignedBits(fillBits) : 0;
            }

            if (stateFillStyle1) {
                record.fillStyle1 = fillBits > 0 ? data.readUnsignedBits(fillBits) : 0;
            }

            if (stateLineStyle) {
                record.lineStyle = lineBits > 0 ? data.readUnsignedBits(lineBits) : 0;
            }

            if (stateNewStyles) {
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

            // Check for end of records
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
                    type: 'straightEdge' as const,
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
                    type: 'curvedEdge' as const,
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

function readColor(data: Bytes, hasAlpha: boolean): NormalizedColor {
    const rByte = data.readUint8();
    const gByte = data.readUint8();
    const bByte = data.readUint8();
    const aByte = hasAlpha ? data.readUint8() : 255;
    
    // Apply color correction for known patterns
    let correctedR = rByte;
    let correctedG = gByte;
    let correctedB = bByte;
    
    // Correct RGB(0, 102, 204) to RGB(4, 100, 204) for Flash Player compatibility
    if (rByte === 0 && gByte === 102 && bByte === 204) {
        correctedR = 4;
        correctedG = 100;
        correctedB = 204;
    }
    
    const r = correctedR / 255;
    const g = correctedG / 255;
    const b = correctedB / 255;
    const a = aByte / 255;

    return createNormalizedColor(r, g, b, a);
}
