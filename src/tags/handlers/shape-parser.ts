import { SwfTagCode } from '../tags';
import { Shape, FillStyle, LineStyle } from '../../swf/shapes';

// Extended Shape interface to include additional properties used in this parser
interface ExtendedShape extends Shape {
    edgeBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
    fillBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
    lineBounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
}

// Extended FillStyle interface to include matrix property
interface ExtendedFillStyle extends FillStyle {
    matrix?: any;
}

/**
 * Parse a SWF shape definition from binary data
 */
export function parseShape(data: any, tagCode: SwfTagCode): Shape {
    // Read shape bounds
    const bounds = data.readRect();
    
    // For DefineShape4, read additional bounds
    let edgeBounds = bounds;
    if (tagCode === SwfTagCode.DefineShape4) {
        edgeBounds = data.readRect();
        
        // Reserved flags and fillWinding
        data.readUBits(5);
        const useNonScalingStrokes = data.readBit();
        const useScalingStrokes = data.readBit();
        data.align();
    }
    
    // Read fill and line style arrays
    const fillStyles = readFillStyleArray(data, tagCode);
    const lineStyles = readLineStyleArray(data, tagCode);
    
    // Read shape records
    const { records, fillBounds, lineBounds } = readShapeRecords(data, tagCode);
    
    // Create shape object with extended properties
    const extendedShape: ExtendedShape = {
        bounds,
        fillStyles,
        lineStyles,
        records
    };
    
    // Add optional properties
    if (edgeBounds) extendedShape.edgeBounds = edgeBounds;
    if (fillBounds) extendedShape.fillBounds = fillBounds;
    if (lineBounds) extendedShape.lineBounds = lineBounds;
    
    return extendedShape;
}

/**
 * Read fill styles from the data stream
 */
function readFillStyleArray(data: any, tagCode: SwfTagCode): FillStyle[] {
    let count = data.readUint8();
    if (count === 0xFF && [SwfTagCode.DefineShape2, SwfTagCode.DefineShape3, SwfTagCode.DefineShape4].includes(tagCode)) {
        count = data.readUint16();
    }
    
    const fillStyles: FillStyle[] = [];
    for (let i = 0; i < count; i++) {
        const type = data.readUint8();
        
        if (type === 0x00) {
            // Solid fill
            const color = tagCode >= SwfTagCode.DefineShape3 ? 
                data.readRGBA() : data.readRGB();
            fillStyles.push({ type, color });
        } 
        else if (type === 0x10 || type === 0x12 || type === 0x13) {
            // Gradient fill
            const matrix = data.readMatrix();
            const gradient = readGradient(data, tagCode);
            fillStyles.push({ type, matrix, gradient });
        }
        else if (type === 0x40 || type === 0x41 || type === 0x42 || type === 0x43) {
            // Bitmap fill
            const bitmapId = data.readUint16();
            const matrix = data.readMatrix();
            fillStyles.push({ type, bitmapId, matrix });
        }
    }
    
    return fillStyles;
}

/**
 * Read line styles from the data stream
 */
function readLineStyleArray(data: any, tagCode: SwfTagCode): LineStyle[] {
    let count = data.readUint8();
    if (count === 0xFF && [SwfTagCode.DefineShape2, SwfTagCode.DefineShape3, SwfTagCode.DefineShape4].includes(tagCode)) {
        count = data.readUint16();
    }
    
    const lineStyles: LineStyle[] = [];
    for (let i = 0; i < count; i++) {
        if (tagCode === SwfTagCode.DefineShape4) {
            // LineStyle2 (Shape4)
            const width = data.readUint16();
            
            // Read bit flags
            const startCapStyle = data.readUBits(2);
            const joinStyle = data.readUBits(2);
            const hasFill = data.readBit();
            const noHScaleFlag = data.readBit();
            const noVScaleFlag = data.readBit();
            const pixelHintingFlag = data.readBit();
            data.readUBits(5); // Reserved
            const noClose = data.readBit();
            const endCapStyle = data.readUBits(2);
            data.align();
            
            // Read miter limit if join style is miter
            let miterLimitFactor = 3;
            if (joinStyle === 2) {
                miterLimitFactor = data.readUI16() / 256;
            }
            
            if (hasFill) {
                // Read fill style
                const fillStyle = readFillStyleArray(data, tagCode)[0];
                // Extract color from fillStyle or use a default white color
                const fillColor = fillStyle.color || { r: 1, g: 1, b: 1, a: 1 };
                lineStyles.push({ 
                    width, 
                    color: fillColor, // Use explicitly named variable to ensure TypeScript recognizes it
                    startCapStyle, 
                    endCapStyle, 
                    joinStyle, 
                    noHScale: noHScaleFlag, 
                    noHScaleFlag,
                    noVScaleFlag,
                    pixelHintingFlag, 
                    noClose, 
                    miterLimitFactor, 
                    fillType: fillStyle 
                });
            } else {
                // Read color
                const color = data.readRGBA();
                lineStyles.push({ 
                    width, 
                    color, 
                    startCapStyle, 
                    endCapStyle, 
                    joinStyle, 
                    noHScale: noHScaleFlag, 
                    noHScaleFlag,  // Using the flag name from the interface
                    noVScaleFlag,  // Using the correct property name
                    pixelHintingFlag, 
                    noClose, 
                    miterLimitFactor 
                });
            }
        } else {
            // Simple line style
            const width = data.readUint16();
            const color = tagCode >= SwfTagCode.DefineShape3 ? 
                data.readRGBA() : data.readRGB();
            lineStyles.push({ width, color });
        }
    }
    
    return lineStyles;
}

/**
 * Read gradient data
 */
function readGradient(data: any, tagCode: SwfTagCode): any {
    const spreadMode = data.readUBits(2);
    const interpolationMode = data.readUBits(2);
    const numGradients = data.readUBits(4);
    
    const gradientRecords = [];
    for (let i = 0; i < numGradients; i++) {
        const ratio = data.readUint8();
        const color = tagCode >= SwfTagCode.DefineShape3 ? 
            data.readRGBA() : data.readRGB();
        gradientRecords.push({ ratio, color });
    }
    
    // For focal gradients (type 0x13), read focal point
    let focalPoint = 0;
    if (tagCode === SwfTagCode.DefineShape4 && (data.lastReadType === 0x13)) {
        focalPoint = data.readUI16() / 256.0;
    }
    
    return {
        spreadMode,
        interpolationMode,
        gradientRecords,
        focalPoint
    };
}

/**
 * Read shape records (geometry data)
 */
function readShapeRecords(data: any, tagCode: SwfTagCode): any {
    // Initialize record parsing state
    let fillStyleOffset = 0;
    let lineStyleOffset = 0;
    let currentFillStyle0 = 0;
    let currentFillStyle1 = 0;
    let currentLineStyle = 0;
    let currentX = 0;
    let currentY = 0;
    const records = [];
    
    // Bounds tracking for optimization
    const fillBounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
    const lineBounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
    
    let endOfShape = false;
    
    while (!endOfShape) {
        // Read type flag
        const isEdgeRecord = data.readBit();
        
        if (isEdgeRecord) {
            // Edge record
            const isStraightEdge = data.readBit();
            
            if (isStraightEdge) {
                // Straight edge record
                const numBits = data.readUBits(4) + 2;
                const generalLineFlag = data.readBit();
                let deltaX = 0;
                let deltaY = 0;
                
                if (generalLineFlag || !data.readBit()) {
                    deltaX = data.readSBits(numBits);
                }
                
                if (generalLineFlag || data.readBit()) {
                    deltaY = data.readSBits(numBits);
                }
                
                // Update current position
                currentX += deltaX;
                currentY += deltaY;
                
                // Update bounds
                if (currentFillStyle0 > 0 || currentFillStyle1 > 0) {
                    fillBounds.xMin = Math.min(fillBounds.xMin, currentX);
                    fillBounds.yMin = Math.min(fillBounds.yMin, currentY);
                    fillBounds.xMax = Math.max(fillBounds.xMax, currentX);
                    fillBounds.yMax = Math.max(fillBounds.yMax, currentY);
                }
                
                if (currentLineStyle > 0) {
                    lineBounds.xMin = Math.min(lineBounds.xMin, currentX);
                    lineBounds.yMin = Math.min(lineBounds.yMin, currentY);
                    lineBounds.xMax = Math.max(lineBounds.xMax, currentX);
                    lineBounds.yMax = Math.max(lineBounds.yMax, currentY);
                }
                
                records.push({
                    type: 'straightEdge',
                    lineTo: { x: currentX, y: currentY }
                });
            } else {
                // Curved edge record
                const numBits = data.readUBits(4) + 2;
                const controlDeltaX = data.readSBits(numBits);
                const controlDeltaY = data.readSBits(numBits);
                const anchorDeltaX = data.readSBits(numBits);
                const anchorDeltaY = data.readSBits(numBits);
                
                // Update current position for control point
                const controlX = currentX + controlDeltaX;
                const controlY = currentY + controlDeltaY;
                
                // Update current position for anchor point
                currentX = controlX + anchorDeltaX;
                currentY = controlY + anchorDeltaY;
                
                // Update bounds
                if (currentFillStyle0 > 0 || currentFillStyle1 > 0) {
                    fillBounds.xMin = Math.min(fillBounds.xMin, controlX, currentX);
                    fillBounds.yMin = Math.min(fillBounds.yMin, controlY, currentY);
                    fillBounds.xMax = Math.max(fillBounds.xMax, controlX, currentX);
                    fillBounds.yMax = Math.max(fillBounds.yMax, controlY, currentY);
                }
                
                if (currentLineStyle > 0) {
                    lineBounds.xMin = Math.min(lineBounds.xMin, controlX, currentX);
                    lineBounds.yMin = Math.min(lineBounds.yMin, controlY, currentY);
                    lineBounds.xMax = Math.max(lineBounds.xMax, controlX, currentX);
                    lineBounds.yMax = Math.max(lineBounds.yMax, controlY, currentY);
                }
                
                records.push({
                    type: 'curvedEdge',
                    curveTo: { 
                        controlX, 
                        controlY, 
                        anchorX: currentX, 
                        anchorY: currentY 
                    }
                });
            }
        } else {
            // Style change record or end record
            const flags = data.readUBits(5);
            
            if (flags === 0) {
                // End of shape
                endOfShape = true;
            } else {
                const styleChangeRecord: any = {
                    type: 'styleChange'
                };
                
                // Move To
                if (flags & 0x01) {
                    const moveBits = data.readUBits(5);
                    const moveX = data.readSBits(moveBits);
                    const moveY = data.readSBits(moveBits);
                    
                    currentX = moveX;
                    currentY = moveY;
                    
                    styleChangeRecord.moveTo = { x: currentX, y: currentY };
                    
                    // Update bounds for move operation
                    if (currentFillStyle0 > 0 || currentFillStyle1 > 0) {
                        fillBounds.xMin = Math.min(fillBounds.xMin, currentX);
                        fillBounds.yMin = Math.min(fillBounds.yMin, currentY);
                        fillBounds.xMax = Math.max(fillBounds.xMax, currentX);
                        fillBounds.yMax = Math.max(fillBounds.yMax, currentY);
                    }
                    
                    if (currentLineStyle > 0) {
                        lineBounds.xMin = Math.min(lineBounds.xMin, currentX);
                        lineBounds.yMin = Math.min(lineBounds.yMin, currentY);
                        lineBounds.xMax = Math.max(lineBounds.xMax, currentX);
                        lineBounds.yMax = Math.max(lineBounds.yMax, currentY);
                    }
                }
                
                // Fill Style 0
                if (flags & 0x02) {
                    currentFillStyle0 = data.readUBits(tagCode < SwfTagCode.DefineShape2 ? 8 : 16);
                    styleChangeRecord.fillStyle0 = currentFillStyle0;
                }
                
                // Fill Style 1
                if (flags & 0x04) {
                    currentFillStyle1 = data.readUBits(tagCode < SwfTagCode.DefineShape2 ? 8 : 16);
                    styleChangeRecord.fillStyle1 = currentFillStyle1;
                }
                
                // Line Style
                if (flags & 0x08) {
                    currentLineStyle = data.readUBits(tagCode < SwfTagCode.DefineShape2 ? 8 : 16);
                    styleChangeRecord.lineStyle = currentLineStyle;
                }
                
                // New Styles
                if (flags & 0x10) {
                    fillStyleOffset = readFillStyleArray(data, tagCode).length;
                    lineStyleOffset = readLineStyleArray(data, tagCode).length;
                    
                    // Number of fill bits
                    data.readUBits(4);
                    // Number of line bits
                    data.readUBits(4);
                    
                    // Note: This case is complex and would require adding the new styles
                    // to the existing style arrays, which we're not handling here for simplicity
                    styleChangeRecord.newStyles = true;
                }
                
                records.push(styleChangeRecord);
            }
        }
        
        data.align();
    }
    
    return { records, fillBounds, lineBounds };
}
