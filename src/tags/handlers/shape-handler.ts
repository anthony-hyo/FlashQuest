import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';
import { parseShape, parseMorphShape } from '../../swf/shapes';

export interface MorphShape {
    startShape: any;
    endShape: any;
    bounds: {
        start: { xMin: number; xMax: number; yMin: number; yMax: number };
        end: { xMin: number; xMax: number; yMin: number; yMax: number };
    };
}

export class ShapeTagHandler extends BaseTagHandler {
    private morphShapes: Map<number, MorphShape> = new Map(); // MEMORY LEAK: Map never cleaned up

    canHandle(tag: TagData): boolean {
        return [
            SwfTagCode.DefineShape,
            SwfTagCode.DefineShape2,
            SwfTagCode.DefineShape3,
            SwfTagCode.DefineShape4,
            SwfTagCode.DefineMorphShape,
            SwfTagCode.DefineMorphShape2
        ].includes(tag.code);
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            const data = tag.data;
            
            // MAGIC NUMBER: 2 bytes for characterId, but no validation it's actually available
            // Check if we have enough data to read characterId
            if (data.remaining < 2) {
                console.warn(`[Shape] Insufficient data for characterId in tag ${tag.code}`);
                return;
            }
            
            const characterId = data.readUint16();

            if (tag.code === SwfTagCode.DefineMorphShape || tag.code === SwfTagCode.DefineMorphShape2) {
                const morphShape = await this.parseMorphShape(data, tag.code);
                this.morphShapes.set(characterId, morphShape);
                frame.actions.push({
                    type: 'defineMorphShape',
                    data: { characterId, morphShape }
                });
            } else {
                // MAGIC NUMBER: 10 bytes minimum is arbitrary and may not be sufficient for all shapes
                // Check if we have enough remaining data for shape parsing
                if (data.remaining < 10) { // Minimum data for bounds + basic shape data
                    console.warn(`[Shape] Insufficient data for shape parsing in tag ${tag.code}, characterId ${characterId}`);
                    return;
                }
                
                const shape = parseShape(data, tag.code);
                frame.actions.push({
                    type: 'defineShape',
                    data: { characterId, shape }
                });
                displayList.addShape(characterId, shape);
                console.log(`[Shape] Successfully parsed shape ${characterId} for tag ${tag.code}`);
            }
        } catch (error) {
            // BUG: Error handling loses context about which characterId failed
            this.handleError(tag, error as Error);
        }
    }

    private async parseMorphShape(data: any, tagCode: number): Promise<MorphShape> {
        // MISSING: Input validation for data parameter
        // MISSING: Bounds checks before reading rect data
        const startBounds = data.readRect();
        const endBounds = data.readRect();
        
        if (tagCode === SwfTagCode.DefineMorphShape2) {
            // Additional bounds for strokes
            data.readRect(); // startEdgeBounds - UNUSED: Read but never stored
            data.readRect(); // endEdgeBounds - UNUSED: Read but never stored
            data.readUint8(); // reserved flags - UNUSED: Read but never validated
        }

        // MISSING: Validation that offset is within valid range
        const offset = data.readUint32();
        const startShape = parseShape(data, SwfTagCode.DefineShape3);  // Morph shapes use Shape3 format
        
        // BUG: Direct position assignment could jump to invalid location
        // MISSING: Bounds check that offset is within data buffer
        // Position data stream at end shape offset
        data.position = offset;
        const endShape = parseShape(data, SwfTagCode.DefineShape3);  // Morph shapes use Shape3 format

        return {
            startShape,
            endShape,
            bounds: {
                start: startBounds,
                end: endBounds
            }
        };
    }

    public getMorphShape(characterId: number): MorphShape | undefined {
        return this.morphShapes.get(characterId);
    }

    public interpolateMorphShape(morphShape: MorphShape, ratio: number): any {
        const { startShape, endShape } = morphShape;
        
        // Interpolate shape data between start and end shapes
        const interpolatedShape = {
            bounds: this.interpolateBounds(morphShape.bounds.start, morphShape.bounds.end, ratio),
            fillStyles: this.interpolateFillStyles(startShape.fillStyles, endShape.fillStyles, ratio),
            lineStyles: this.interpolateLineStyles(startShape.lineStyles, endShape.lineStyles, ratio),
            records: this.interpolateRecords(startShape.records, endShape.records, ratio)
        };

        return interpolatedShape;
    }

    private interpolateBounds(start: any, end: any, ratio: number) {
        return {
            xMin: start.xMin + (end.xMin - start.xMin) * ratio,
            xMax: start.xMax + (end.xMax - start.xMax) * ratio,
            yMin: start.yMin + (end.yMin - start.yMin) * ratio,
            yMax: start.yMax + (end.yMax - start.yMax) * ratio
        };
    }

    private interpolateFillStyles(startStyles: any[], endStyles: any[], ratio: number) {
        return startStyles.map((startStyle, index) => {
            const endStyle = endStyles[index];
            if (!endStyle) return startStyle;

            switch (startStyle.type) {
                case 0x00: // Solid fill
                    return {
                        type: 0x00,
                        color: this.interpolateColor(startStyle.color, endStyle.color, ratio)
                    };
                case 0x10: // Linear gradient
                case 0x12: // Radial gradient
                    return {
                        type: startStyle.type,
                        gradient: this.interpolateGradient(startStyle.gradient, endStyle.gradient, ratio)
                    };
                default:
                    return startStyle;
            }
        });
    }

    private interpolateLineStyles(startStyles: any[], endStyles: any[], ratio: number) {
        return startStyles.map((startStyle, index) => {
            const endStyle = endStyles[index];
            if (!endStyle) return startStyle;

            return {
                width: startStyle.width + (endStyle.width - startStyle.width) * ratio,
                color: this.interpolateColor(startStyle.color, endStyle.color, ratio)
            };
        });
    }

    private interpolateColor(start: any, end: any, ratio: number) {
        return {
            r: start.r + (end.r - start.r) * ratio,
            g: start.g + (end.g - start.g) * ratio,
            b: start.b + (end.b - start.b) * ratio,
            a: start.a + (end.a - start.a) * ratio
        };
    }

    private interpolateGradient(start: any, end: any, ratio: number) {
        return {
            records: start.records.map((startRecord: any, index: number) => {
                const endRecord = end.records[index];
                return {
                    ratio: startRecord.ratio + (endRecord.ratio - startRecord.ratio) * ratio,
                    color: this.interpolateColor(startRecord.color, endRecord.color, ratio)
                };
            })
        };
    }

    private interpolateRecords(startRecords: any[], endRecords: any[], ratio: number) {
        // This is a simplified version - a full implementation would need to handle
        // all edge types and style changes appropriately
        return startRecords.map((startRecord, index) => {
            const endRecord = endRecords[index];
            if (!endRecord) return startRecord;

            if (startRecord.type === 'styleChange') {
                return startRecord; // Style changes don't interpolate
            }

            // Interpolate edge records (straight or curved)
            const interpolated = { ...startRecord };
            if (startRecord.type === 'straightEdge') {
                if (startRecord.lineTo && endRecord.lineTo) {
                    interpolated.lineTo = {
                        x: startRecord.lineTo.x + (endRecord.lineTo.x - startRecord.lineTo.x) * ratio,
                        y: startRecord.lineTo.y + (endRecord.lineTo.y - startRecord.lineTo.y) * ratio
                    };
                }
            } else if (startRecord.type === 'curvedEdge') {
                if (startRecord.curveTo && endRecord.curveTo) {
                    interpolated.curveTo = {
                        controlX: startRecord.curveTo.controlX + (endRecord.curveTo.controlX - startRecord.curveTo.controlX) * ratio,
                        controlY: startRecord.curveTo.controlY + (endRecord.curveTo.controlY - startRecord.curveTo.controlY) * ratio,
                        anchorX: startRecord.curveTo.anchorX + (endRecord.curveTo.anchorX - startRecord.curveTo.anchorX) * ratio,
                        anchorY: startRecord.curveTo.anchorY + (endRecord.curveTo.anchorY - startRecord.curveTo.anchorY) * ratio
                    };
                }
            }

            return interpolated;
        });
    }
}
