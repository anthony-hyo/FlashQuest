import { RenderObject } from './renderer';
import { Shape, Color } from '../swf/shapes';

export class RenderBatch {
    private static readonly VERTICES_PER_QUAD = 4;
    private static readonly INDICES_PER_QUAD = 6;
    private static readonly VERTEX_SIZE = 2; // x, y
    private static readonly COLOR_SIZE = 4;  // r, g, b, a
    private static readonly UV_SIZE = 2;     // u, v

    private vertices: Float32Array;
    private colors: Float32Array;
    private uvs: Float32Array;
    private indices: Uint16Array;
    private currentTextureId: number | null = null;
    private count: number = 0;
    
    constructor(private maxQuads: number) {
        this.vertices = new Float32Array(maxQuads * RenderBatch.VERTICES_PER_QUAD * RenderBatch.VERTEX_SIZE);
        this.colors = new Float32Array(maxQuads * RenderBatch.VERTICES_PER_QUAD * RenderBatch.COLOR_SIZE);
        this.uvs = new Float32Array(maxQuads * RenderBatch.VERTICES_PER_QUAD * RenderBatch.UV_SIZE);
        this.indices = new Uint16Array(maxQuads * RenderBatch.INDICES_PER_QUAD);
        this.initIndices();
    }

    private initIndices() {
        for (let i = 0; i < this.maxQuads; i++) {
            const baseIndex = i * RenderBatch.INDICES_PER_QUAD;
            const baseVertex = i * RenderBatch.VERTICES_PER_QUAD;
            this.indices[baseIndex] = baseVertex;
            this.indices[baseIndex + 1] = baseVertex + 1;
            this.indices[baseIndex + 2] = baseVertex + 2;
            this.indices[baseIndex + 3] = baseVertex + 2;
            this.indices[baseIndex + 4] = baseVertex + 3;
            this.indices[baseIndex + 5] = baseVertex;
        }
    }

    canAdd(obj: RenderObject): boolean {
        if (this.count >= this.maxQuads) return false;
        if (this.currentTextureId === null) return true;
        return this.currentTextureId === this.getTextureIdFromObject(obj);
    }

    add(obj: RenderObject, matrix: Float32Array): boolean {
        if (!this.canAdd(obj)) return false;

        const texId = this.getTextureIdFromObject(obj);
        if (this.currentTextureId === null) this.currentTextureId = texId;

        const shape = obj.shape as Shape; // Handle morph shapes separately
        const vertices = this.triangulateShape(shape);
        const fillStyle = shape.fillStyles[0];
        const color = this.getColor(fillStyle);

        // Transform vertices by matrix
        const transformedVerts = this.transformVertices(vertices, matrix);

        // Add quad to batch
        const baseVertex = this.count * RenderBatch.VERTICES_PER_QUAD;
        const baseColor = baseVertex * RenderBatch.COLOR_SIZE;
        const baseUV = baseVertex * RenderBatch.UV_SIZE;

        for (let i = 0; i < transformedVerts.length; i += 2) {
            const vi = baseVertex + i/2;
            const ci = baseColor + (i/2) * RenderBatch.COLOR_SIZE;
            const uvi = baseUV + i;

            // Vertices
            this.vertices[vi * 2] = transformedVerts[i];
            this.vertices[vi * 2 + 1] = transformedVerts[i + 1];

            // Colors
            this.colors[ci] = color.r;
            this.colors[ci + 1] = color.g;
            this.colors[ci + 2] = color.b;
            this.colors[ci + 3] = color.a;

            // UVs
            if (fillStyle && fillStyle.type >= 0x40) { // Bitmap fill
                this.uvs[uvi] = transformedVerts[i] / shape.bounds.xMax;
                this.uvs[uvi + 1] = transformedVerts[i + 1] / shape.bounds.yMax;
            } else {
                this.uvs[uvi] = 0;
                this.uvs[uvi + 1] = 0;
            }
        }

        this.count++;
        return true;
    }

    clear() {
        this.count = 0;
        this.currentTextureId = null;
    }

    getVertexData(): Float32Array {
        return this.vertices.subarray(0, this.count * RenderBatch.VERTICES_PER_QUAD * RenderBatch.VERTEX_SIZE);
    }

    getColorData(): Float32Array {
        return this.colors.subarray(0, this.count * RenderBatch.VERTICES_PER_QUAD * RenderBatch.COLOR_SIZE);
    }

    getUVData(): Float32Array {
        return this.uvs.subarray(0, this.count * RenderBatch.VERTICES_PER_QUAD * RenderBatch.UV_SIZE);
    }

    getIndexData(): Uint16Array {
        return this.indices.subarray(0, this.count * RenderBatch.INDICES_PER_QUAD);
    }

    getTextureId(): number | null {
        return this.currentTextureId;
    }

    setTextureId(id: number | null): void {
        this.currentTextureId = id;
    }

    private getTextureIdFromObject(obj: RenderObject): number | null {
        const shape = obj.shape as Shape;
        const fillStyle = shape.fillStyles[0];
        return fillStyle && fillStyle.type >= 0x40 ? (fillStyle.bitmapId ?? null) : null;
    }

    private getColor(fillStyle: any): Color {
        if (!fillStyle) return { r: 1, g: 1, b: 1, a: 1 };
        return fillStyle.color || { r: 1, g: 1, b: 1, a: 1 };
    }

    private transformVertices(vertices: number[], matrix: Float32Array): number[] {
        const result = new Array(vertices.length);
        for (let i = 0; i < vertices.length; i += 2) {
            const x = vertices[i];
            const y = vertices[i + 1];
            result[i] = matrix[0] * x + matrix[4] * y + matrix[12];
            result[i + 1] = matrix[1] * x + matrix[5] * y + matrix[13];
        }
        return result;
    }

    private triangulateShape(shape: Shape): number[] {
        // We assume the shape is already triangulated
        // This method should just extract the vertex data
        const vertices: number[] = [];
        for (const record of shape.records) {
            if (record.type === 'styleChange' && record.moveTo) {
                vertices.push(record.moveTo.x, record.moveTo.y);
            } else if (record.type === 'straightEdge' && record.lineTo) {
                vertices.push(record.lineTo.x, record.lineTo.y);
            } else if (record.type === 'curvedEdge' && record.curveTo) {
                // For curves, we need to add both control and anchor points
                vertices.push(
                    record.curveTo.controlX, record.curveTo.controlY,
                    record.curveTo.anchorX, record.curveTo.anchorY
                );
            }
        }
        return vertices;
    }
}
