import { Color, FillStyle, LineStyle, Shape, ShapeRecord } from '../swf/shapes';
import { Matrix } from '../utils/bytes';

export interface RenderObject {
    shape: Shape;
    matrix: Matrix;
    colorTransform?: any;
    depth: number;
    characterId: number;
}

export class WebGLRenderer {
    private gl: WebGLRenderingContext;
    private shapeProgram!: WebGLProgram;
    private gradientProgram!: WebGLProgram;
    private positionBuffer!: WebGLBuffer;
    private colorBuffer!: WebGLBuffer;
    private indexBuffer!: WebGLBuffer;

    // Uniforms para shape program
    private shapeUniforms!: {
        resolution: WebGLUniformLocation;
        matrix: WebGLUniformLocation;
        color: WebGLUniformLocation;
    };

    // Uniforms para gradient program
    private gradientUniforms!: {
        resolution: WebGLUniformLocation;
        matrix: WebGLUniformLocation;
        gradientMatrix: WebGLUniformLocation;
        gradientColors: WebGLUniformLocation;
        gradientStops: WebGLUniformLocation;
        gradientType: WebGLUniformLocation;
    };

    private canvas: HTMLCanvasElement;
    private backgroundColor: Color = { r: 1, g: 1, b: 1, a: 1 };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl', {
            antialias: true,
            alpha: true,
            premultipliedAlpha: false
        });

        if (!gl) {
            throw new Error('WebGL não suportado');
        }

        this.gl = gl;
        this.initShaders();
        this.initBuffers();
        this.setupGL();
    }

    private initShaders() {
        // Shader para formas sólidas
        const shapeVertexShader = `
            attribute vec2 a_position;
            uniform vec2 u_resolution;
            uniform mat3 u_matrix;
            
            void main() {
                vec3 position = u_matrix * vec3(a_position, 1.0);
                vec2 zeroToOne = position.xy / u_resolution;
                vec2 zeroToTwo = zeroToOne * 2.0;
                vec2 clipSpace = zeroToTwo - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            }
        `;

        const shapeFragmentShader = `
            precision mediump float;
            uniform vec4 u_color;
            
            void main() {
                gl_FragColor = u_color;
            }
        `;

        // Shader para gradientes
        const gradientVertexShader = `
            attribute vec2 a_position;
            uniform vec2 u_resolution;
            uniform mat3 u_matrix;
            uniform mat3 u_gradientMatrix;
            varying vec2 v_gradientCoord;
            
            void main() {
                vec3 position = u_matrix * vec3(a_position, 1.0);
                vec2 zeroToOne = position.xy / u_resolution;
                vec2 zeroToTwo = zeroToOne * 2.0;
                vec2 clipSpace = zeroToTwo - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                
                // Calcular coordenadas do gradiente
                vec3 gradPos = u_gradientMatrix * vec3(a_position, 1.0);
                v_gradientCoord = gradPos.xy;
            }
        `;

        const gradientFragmentShader = `
            precision mediump float;
            uniform vec4 u_gradientColors[8];
            uniform float u_gradientStops[8];
            uniform int u_gradientType; // 0 = linear, 1 = radial
            varying vec2 v_gradientCoord;
            
            void main() {
                float t;
                
                if (u_gradientType == 0) {
                    // Gradiente linear
                    t = v_gradientCoord.x;
                } else {
                    // Gradiente radial
                    t = length(v_gradientCoord);
                }
                
                t = clamp(t, 0.0, 1.0);
                
                // Interpolar entre cores do gradiente
                vec4 color = u_gradientColors[0];
                for (int i = 1; i < 8; i++) {
                    if (t >= u_gradientStops[i-1] && t <= u_gradientStops[i]) {
                        float factor = (t - u_gradientStops[i-1]) / (u_gradientStops[i] - u_gradientStops[i-1]);
                        color = mix(u_gradientColors[i-1], u_gradientColors[i], factor);
                        break;
                    }
                }
                
                gl_FragColor = color;
            }
        `;

        this.shapeProgram = this.createProgram(shapeVertexShader, shapeFragmentShader)!;
        this.gradientProgram = this.createProgram(gradientVertexShader, gradientFragmentShader)!;

        // Obter localizações dos uniforms
        this.shapeUniforms = {
            resolution: this.gl.getUniformLocation(this.shapeProgram, 'u_resolution')!,
            matrix: this.gl.getUniformLocation(this.shapeProgram, 'u_matrix')!,
            color: this.gl.getUniformLocation(this.shapeProgram, 'u_color')!
        };

        this.gradientUniforms = {
            resolution: this.gl.getUniformLocation(this.gradientProgram, 'u_resolution')!,
            matrix: this.gl.getUniformLocation(this.gradientProgram, 'u_matrix')!,
            gradientMatrix: this.gl.getUniformLocation(this.gradientProgram, 'u_gradientMatrix')!,
            gradientColors: this.gl.getUniformLocation(this.gradientProgram, 'u_gradientColors')!,
            gradientStops: this.gl.getUniformLocation(this.gradientProgram, 'u_gradientStops')!,
            gradientType: this.gl.getUniformLocation(this.gradientProgram, 'u_gradientType')!
        };
    }

    private initBuffers() {
        this.positionBuffer = this.gl.createBuffer()!;
        this.colorBuffer = this.gl.createBuffer()!;
        this.indexBuffer = this.gl.createBuffer()!;
    }

    private setupGL() {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);
    }

    private createShader(type: number, source: string): WebGLShader | null {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            return shader;
        }

        console.error('Erro no shader:', this.gl.getShaderInfoLog(shader));
        this.gl.deleteShader(shader);
        return null;
    }

    private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram | null {
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);

        if (!vertexShader || !fragmentShader) {
            return null;
        }

        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            return program;
        }

        console.error('Erro no programa:', this.gl.getProgramInfoLog(program));
        this.gl.deleteProgram(program);
        return null;
    }

    setBackgroundColor(color: Color) {
        this.backgroundColor = color;
    }

    clear() {
        this.gl.clearColor(
            this.backgroundColor.r,
            this.backgroundColor.g,
            this.backgroundColor.b,
            this.backgroundColor.a
        );
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }

    render(objects: RenderObject[]) {
        this.clear();

        // Ordenar por profundidade
        objects.sort((a, b) => a.depth - b.depth);

        for (const obj of objects) {
            this.renderShape(obj);
        }
    }

    private renderShape(obj: RenderObject) {
        const { shape, matrix } = obj;

        // Triangular a forma
        const triangles = this.triangulateShape(shape);

        if (triangles.length === 0) return;

        // Renderizar cada triângulo
        for (const triangle of triangles) {
            this.renderTriangle(triangle, matrix);
        }
    }

    private triangulateShape(shape: Shape): Triangle[] {
        const triangles: Triangle[] = [];
        const paths = this.extractPaths(shape.records);

        for (const path of paths) {
            if (path.length < 3) continue;

            // Triangulação simples usando ear clipping
            const pathTriangles = this.earClipping(path);

            // Determinar estilo de preenchimento
            const fillStyle = shape.fillStyles[0]; // Simplificado

            for (const tri of pathTriangles) {
                triangles.push({
                    vertices: tri,
                    fillStyle: fillStyle || { type: 0, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }
                });
            }
        }

        return triangles;
    }

    private extractPaths(records: ShapeRecord[]): Point[][] {
        const paths: Point[][] = [];
        let currentPath: Point[] = [];
        let currentX = 0;
        let currentY = 0;

        for (const record of records) {
            switch (record.type) {
                case 'styleChange':
                    if (record.moveTo) {
                        if (currentPath.length > 0) {
                            paths.push([...currentPath]);
                            currentPath = [];
                        }
                        currentX = record.moveTo.x;
                        currentY = record.moveTo.y;
                        currentPath.push({ x: currentX, y: currentY });
                    }
                    break;

                case 'straightEdge':
                    if (record.lineTo) {
                        currentX = record.lineTo.x;
                        currentY = record.lineTo.y;
                        currentPath.push({ x: currentX, y: currentY });
                    }
                    break;

                case 'curvedEdge':
                    if (record.curveTo) {
                        // Aproximar curva com segmentos de linha
                        const steps = 10;
                        const startX = currentX;
                        const startY = currentY;

                        for (let i = 1; i <= steps; i++) {
                            const t = i / steps;
                            const x = this.quadraticBezier(startX, record.curveTo.controlX, record.curveTo.anchorX, t);
                            const y = this.quadraticBezier(startY, record.curveTo.controlY, record.curveTo.anchorY, t);
                            currentPath.push({ x, y });
                        }

                        currentX = record.curveTo.anchorX;
                        currentY = record.curveTo.anchorY;
                    }
                    break;
            }
        }

        if (currentPath.length > 0) {
            paths.push(currentPath);
        }

        return paths;
    }

    private quadraticBezier(p0: number, p1: number, p2: number, t: number): number {
        const oneMinusT = 1 - t;
        return oneMinusT * oneMinusT * p0 + 2 * oneMinusT * t * p1 + t * t * p2;
    }

    private earClipping(path: Point[]): Point[][] {
        const triangles: Point[][] = [];
        const vertices = [...path];

        while (vertices.length > 3) {
            let earFound = false;

            for (let i = 0; i < vertices.length; i++) {
                const prev = vertices[(i - 1 + vertices.length) % vertices.length];
                const curr = vertices[i];
                const next = vertices[(i + 1) % vertices.length];

                if (this.isEar(prev, curr, next, vertices)) {
                    triangles.push([prev, curr, next]);
                    vertices.splice(i, 1);
                    earFound = true;
                    break;
                }
            }

            if (!earFound) {
                // Fallback: criar triângulo em leque
                for (let i = 1; i < vertices.length - 1; i++) {
                    triangles.push([vertices[0], vertices[i], vertices[i + 1]]);
                }
                break;
            }
        }

        if (vertices.length === 3) {
            triangles.push(vertices);
        }

        return triangles;
    }

    private isEar(prev: Point, curr: Point, next: Point, vertices: Point[]): boolean {
        // Verificar se o triângulo é convexo
        const cross = (next.x - curr.x) * (prev.y - curr.y) - (next.y - curr.y) * (prev.x - curr.x);
        if (cross <= 0) return false;

        // Verificar se nenhum outro vértice está dentro do triângulo
        for (const vertex of vertices) {
            if (vertex === prev || vertex === curr || vertex === next) continue;
            if (this.pointInTriangle(vertex, prev, curr, next)) {
                return false;
            }
        }

        return true;
    }

    private pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
        const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(denom) < 1e-10) return false;

        const alpha = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
        const beta = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
        const gamma = 1 - alpha - beta;

        return alpha >= 0 && beta >= 0 && gamma >= 0;
    }

    private renderTriangle(triangle: Triangle, matrix: Matrix) {
        const { vertices, fillStyle } = triangle;

        // Converter vértices para array
        const positions = new Float32Array([
            vertices[0].x, vertices[0].y,
            vertices[1].x, vertices[1].y,
            vertices[2].x, vertices[2].y
        ]);

        // Criar matriz de transformação
        const transformMatrix = this.createTransformMatrix(matrix);

        if (fillStyle.gradient) {
            this.renderGradientTriangle(positions, transformMatrix, fillStyle);
        } else {
            this.renderSolidTriangle(positions, transformMatrix, fillStyle.color || { r: 0.5, g: 0.5, b: 0.5, a: 1 });
        }
    }

    private renderSolidTriangle(positions: Float32Array, matrix: Float32Array, color: Color) {
        this.gl.useProgram(this.shapeProgram);

        // Configurar atributos
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

        const positionLocation = this.gl.getAttribLocation(this.shapeProgram, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Configurar uniforms
        this.gl.uniform2f(this.shapeUniforms.resolution, this.canvas.width, this.canvas.height);
        this.gl.uniformMatrix3fv(this.shapeUniforms.matrix, false, matrix);
        this.gl.uniform4f(this.shapeUniforms.color, color.r, color.g, color.b, color.a);

        // Desenhar
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    private renderGradientTriangle(positions: Float32Array, matrix: Float32Array, fillStyle: FillStyle) {
        this.gl.useProgram(this.gradientProgram);

        // Configurar atributos
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

        const positionLocation = this.gl.getAttribLocation(this.gradientProgram, 'a_position');
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);

        // Configurar uniforms
        this.gl.uniform2f(this.gradientUniforms.resolution, this.canvas.width, this.canvas.height);
        this.gl.uniformMatrix3fv(this.gradientUniforms.matrix, false, matrix);

        if (fillStyle.gradient && fillStyle.bitmapMatrix) {
            const gradientMatrix = this.createTransformMatrix(fillStyle.bitmapMatrix);
            this.gl.uniformMatrix3fv(this.gradientUniforms.gradientMatrix, false, gradientMatrix);

            // Configurar cores e stops do gradiente
            const colors = new Float32Array(32); // 8 cores * 4 componentes
            const stops = new Float32Array(8);

            for (let i = 0; i < Math.min(8, fillStyle.gradient.gradientRecords.length); i++) {
                const record = fillStyle.gradient.gradientRecords[i];
                colors[i * 4] = record.color.r;
                colors[i * 4 + 1] = record.color.g;
                colors[i * 4 + 2] = record.color.b;
                colors[i * 4 + 3] = record.color.a;
                stops[i] = record.ratio / 255;
            }

            this.gl.uniform4fv(this.gradientUniforms.gradientColors, colors);
            this.gl.uniform1fv(this.gradientUniforms.gradientStops, stops);

            const gradientType = fillStyle.type === 0x10 ? 0 : 1; // 0 = linear, 1 = radial
            this.gl.uniform1i(this.gradientUniforms.gradientType, gradientType);
        }

        // Desenhar
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    private createTransformMatrix(matrix: Matrix): Float32Array {
        // Converter matriz SWF para matriz WebGL 3x3
        return new Float32Array([
            matrix.scaleX, matrix.rotateSkew0, matrix.translateX,
            matrix.rotateSkew1, matrix.scaleY, matrix.translateY,
            0, 0, 1
        ]);
    }
}

interface Point {
    x: number;
    y: number;
}

interface Triangle {
    vertices: Point[];
    fillStyle: FillStyle;
}

