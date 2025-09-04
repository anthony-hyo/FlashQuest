import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';
import { Shape, Color } from '../../swf/shapes';
import { Matrix } from '../../utils/bytes';
import { MorphShape } from '../../swf/morph-shapes';

// MorphShape support and interpolation
export interface MorphShapeData {
    startShape: Shape;
    endShape: Shape;
    ratio: number;
}

export class MorphShapeHandler extends BaseTagHandler {
    private morphShapes: Map<number, MorphShape> = new Map();

    canHandle(tag: TagData): boolean {
        return [
            SwfTagCode.DefineMorphShape,
            SwfTagCode.DefineMorphShape2
        ].includes(tag.code);
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            if (tag.code === SwfTagCode.DefineMorphShape || tag.code === SwfTagCode.DefineMorphShape2) {
                const data = tag.data;
                const characterId = data.readUint16();
                
                const startBounds = data.readRect();
                const endBounds = data.readRect();

                if (tag.code === SwfTagCode.DefineMorphShape2) {
                    // Handle additional morph shape 2 data
                    data.readRect(); // startEdgeBounds
                    data.readRect(); // endEdgeBounds
                    data.readUint8(); // reserved flags
                }

                const offset = data.readUint32();
                
                // Read start shape at current position
                const startShape = this.readMorphShape(data);
                
                // Move to end shape position
                data.position = offset;
                
                // Read end shape
                const endShape = this.readMorphShape(data);

                // Create morph shape object
                const morphShape: MorphShape = {
                    startShape,
                    endShape,
                    startEdges: {
                        vertices: [],
                        indices: []
                    },
                    endEdges: {
                        vertices: [],
                        indices: []
                    },
                    startFills: [],
                    endFills: [],
                    ratio: 0 // Initial ratio
                };

                this.morphShapes.set(characterId, morphShape);

                // Add to frame actions
                frame.actions.push({
                    type: 'defineMorphShape',
                    data: { characterId, morphShape }
                });
            }
        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    interpolate(shape: MorphShape, ratio: number): Shape {
        // Ensure ratio is between 0 and 1
        ratio = Math.max(0, Math.min(1, ratio));

        return {
            bounds: this.interpolateBounds(shape.startShape.bounds, shape.endShape.bounds, ratio),
            fillStyles: this.interpolateStyles(shape.startShape.fillStyles, shape.endShape.fillStyles, ratio),
            lineStyles: this.interpolateLineStyles(shape.startShape.lineStyles, shape.endShape.lineStyles, ratio),
            records: this.interpolateRecords(shape.startShape.records, shape.endShape.records, ratio)
        };
    }

    private readMorphShape(data: any): Shape {
        // Read fill style count
        const fillStyleCount = data.readUint8();
        const fillStyles = this.readFillStyles(data, fillStyleCount);

        // Read line style count
        const lineStyleCount = data.readUint8();
        const lineStyles = this.readLineStyles(data, lineStyleCount);

        // Read shape records
        const records = this.readShapeRecords(data);

        return {
            bounds: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 }, // Bounds are set separately
            fillStyles,
            lineStyles,
            records
        };
    }

    private readFillStyles(data: any, count: number): any[] {
        const styles = [];
        for (let i = 0; i < count; i++) {
            const type = data.readUint8();
            switch (type) {
                case 0x00: // Solid fill
                    styles.push({
                        type,
                        color: this.readRGBA(data)
                    });
                    break;
                case 0x10: // Linear gradient
                case 0x12: // Radial gradient
                    styles.push({
                        type,
                        matrix: data.readMatrix(),
                        gradient: this.readGradient(data)
                    });
                    break;
                case 0x40: // Bitmap fill
                case 0x41:
                case 0x42:
                case 0x43:
                    styles.push({
                        type,
                        bitmapId: data.readUint16(),
                        matrix: data.readMatrix()
                    });
                    break;
            }
        }
        return styles;
    }

    private readLineStyles(data: any, count: number): any[] {
        const styles = [];
        for (let i = 0; i < count; i++) {
            styles.push({
                width: data.readUint16(),
                color: this.readRGBA(data)
            });
        }
        return styles;
    }

    private readShapeRecords(data: any): any[] {
        const records = [];
        while (true) {
            const typeFlag = data.readUBits(1);
            if (typeFlag === 0) {
                const flags = data.readUBits(5);
                if (flags === 0) break; // End of shape

                // Style change record
                const record: any = { type: 'styleChange' };
                if (flags & 0x01) record.moveTo = this.readMoveTo(data);
                if (flags & 0x02) record.fillStyle0 = data.readUBits(4);
                if (flags & 0x04) record.fillStyle1 = data.readUBits(4);
                if (flags & 0x08) record.lineStyle = data.readUBits(4);
                records.push(record);
            } else {
                const straight = data.readUBits(1);
                if (straight) {
                    records.push({
                        type: 'straightEdge',
                        lineTo: this.readStraightEdge(data)
                    });
                } else {
                    records.push({
                        type: 'curvedEdge',
                        curveTo: this.readCurvedEdge(data)
                    });
                }
            }
        }
        return records;
    }

    private readRGBA(data: any): Color {
        return {
            r: data.readUint8() / 255,
            g: data.readUint8() / 255,
            b: data.readUint8() / 255,
            a: data.readUint8() / 255
        };
    }

    private readGradient(data: any): any {
        const records = [];
        const count = data.readUint8();
        for (let i = 0; i < count; i++) {
            records.push({
                ratio: data.readUint8(),
                color: this.readRGBA(data)
            });
        }
        return { records };
    }

    private readMoveTo(data: any): { x: number; y: number } {
        const bits = data.readUBits(5);
        return {
            x: data.readSBits(bits),
            y: data.readSBits(bits)
        };
    }

    private readStraightEdge(data: any): { x: number; y: number } {
        const bits = data.readUBits(4) + 2;
        const general = data.readUBits(1);
        if (general) {
            return {
                x: data.readSBits(bits),
                y: data.readSBits(bits)
            };
        } else {
            const vert = data.readUBits(1);
            return vert ? 
                { x: 0, y: data.readSBits(bits) } :
                { x: data.readSBits(bits), y: 0 };
        }
    }

    private readCurvedEdge(data: any): { controlX: number; controlY: number; anchorX: number; anchorY: number } {
        const bits = data.readUBits(4) + 2;
        return {
            controlX: data.readSBits(bits),
            controlY: data.readSBits(bits),
            anchorX: data.readSBits(bits),
            anchorY: data.readSBits(bits)
        };
    }

    private interpolateBounds(start: any, end: any, ratio: number): any {
        return {
            xMin: start.xMin + (end.xMin - start.xMin) * ratio,
            xMax: start.xMax + (end.xMax - start.xMax) * ratio,
            yMin: start.yMin + (end.yMin - start.yMin) * ratio,
            yMax: start.yMax + (end.yMax - start.yMax) * ratio
        };
    }

    private interpolateStyles(startStyles: any[], endStyles: any[], ratio: number): any[] {
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
                        matrix: this.interpolateMatrix(startStyle.matrix, endStyle.matrix, ratio),
                        gradient: this.interpolateGradient(startStyle.gradient, endStyle.gradient, ratio)
                    };
                default:
                    return startStyle;
            }
        });
    }

    private interpolateLineStyles(startStyles: any[], endStyles: any[], ratio: number): any[] {
        return startStyles.map((startStyle, index) => {
            const endStyle = endStyles[index];
            if (!endStyle) return startStyle;

            return {
                width: startStyle.width + (endStyle.width - startStyle.width) * ratio,
                color: this.interpolateColor(startStyle.color, endStyle.color, ratio)
            };
        });
    }

    private interpolateColor(start: Color, end: Color, ratio: number): Color {
        return {
            r: start.r + (end.r - start.r) * ratio,
            g: start.g + (end.g - start.g) * ratio,
            b: start.b + (end.b - start.b) * ratio,
            a: start.a + (end.a - start.a) * ratio
        };
    }

    private interpolateMatrix(start: Matrix, end: Matrix, ratio: number): Matrix {
        return {
            scaleX: start.scaleX + (end.scaleX - start.scaleX) * ratio,
            scaleY: start.scaleY + (end.scaleY - start.scaleY) * ratio,
            rotateSkew0: start.rotateSkew0 + (end.rotateSkew0 - start.rotateSkew0) * ratio,
            rotateSkew1: start.rotateSkew1 + (end.rotateSkew1 - start.rotateSkew1) * ratio,
            translateX: start.translateX + (end.translateX - start.translateX) * ratio,
            translateY: start.translateY + (end.translateY - start.translateY) * ratio
        };
    }

    private interpolateGradient(start: any, end: any, ratio: number): any {
        return {
            records: start.records.map((startRec: any, index: number) => {
                const endRec = end.records[index];
                return {
                    ratio: startRec.ratio + (endRec.ratio - startRec.ratio) * ratio,
                    color: this.interpolateColor(startRec.color, endRec.color, ratio)
                };
            })
        };
    }

    private interpolateRecords(startRecs: any[], endRecs: any[], ratio: number): any[] {
        return startRecs.map((start, index) => {
            const end = endRecs[index];
            if (!end || start.type !== end.type) return start;

            switch (start.type) {
                case 'styleChange':
                    return start; // Style changes don't interpolate
                case 'straightEdge':
                    return {
                        type: 'straightEdge',
                        lineTo: this.interpolatePoint(start.lineTo, end.lineTo, ratio)
                    };
                case 'curvedEdge':
                    return {
                        type: 'curvedEdge',
                        curveTo: {
                            controlX: start.curveTo.controlX + (end.curveTo.controlX - start.curveTo.controlX) * ratio,
                            controlY: start.curveTo.controlY + (end.curveTo.controlY - start.curveTo.controlY) * ratio,
                            anchorX: start.curveTo.anchorX + (end.curveTo.anchorX - start.curveTo.anchorX) * ratio,
                            anchorY: start.curveTo.anchorY + (end.curveTo.anchorY - start.curveTo.anchorY) * ratio
                        }
                    };
                default:
                    return start;
            }
        });
    }

    private interpolatePoint(start: any, end: any, ratio: number): any {
        return {
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio
        };
    }
}
