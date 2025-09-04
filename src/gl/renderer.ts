import { Shape, Color, FillStyle, Gradient } from '../swf/shapes';
import { Matrix, ColorTransform } from '../utils/bytes';

export interface RenderObject {
    shape: Shape;
    matrix?: Matrix;
    colorTransform?: ColorTransform;
    depth: number;
    characterId: number;
}

export class WebGLRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext;
    private shaderProgram: WebGLProgram;
    private gradientShaderProgram: WebGLProgram;
    private bitmapShaderProgram: WebGLProgram;
    private vertexBuffer: WebGLBuffer;
    private colorBuffer: WebGLBuffer;
    private uvBuffer: WebGLBuffer;
    private backgroundColor: Color = { r: 1, g: 1, b: 1, a: 1 };

    // Shader attributes and uniforms for solid colors
    private aVertexPosition: number;
    private aVertexColor: number;
    private uProjectionMatrix: WebGLUniformLocation;
    private uModelViewMatrix: WebGLUniformLocation;

    // Gradient shader attributes and uniforms
    private aGradientPosition: number;
    private aGradientUV: number;
    private uGradientProjectionMatrix: WebGLUniformLocation;
    private uGradientModelViewMatrix: WebGLUniformLocation;
    private uGradientMatrix: WebGLUniformLocation;
    private uGradientColors: WebGLUniformLocation;
    private uGradientStops: WebGLUniformLocation;
    private uGradientType: WebGLUniformLocation;
    private uGradientFocalPoint: WebGLUniformLocation;

    // Bitmap shader attributes and uniforms
    private aBitmapPosition: number;
    private aBitmapUV: number;
    private uBitmapProjectionMatrix: WebGLUniformLocation;
    private uBitmapModelViewMatrix: WebGLUniformLocation;
    private uBitmapTexture: WebGLUniformLocation;
    private uBitmapMatrix: WebGLUniformLocation;

    // Texture storage for bitmaps
    private textures: Map<number, WebGLTexture> = new Map();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (!gl) {
            throw new Error('WebGL não suportado pelo navegador');
        }
        
        this.gl = gl as WebGLRenderingContext;
        
        // Initialize all shader programs
        const solidResult = this.initSolidShaders();
        this.shaderProgram = solidResult.program;
        this.aVertexPosition = solidResult.aVertexPosition;
        this.aVertexColor = solidResult.aVertexColor;
        this.uProjectionMatrix = solidResult.uProjectionMatrix;
        this.uModelViewMatrix = solidResult.uModelViewMatrix;

        const gradientResult = this.initGradientShaders();
        this.gradientShaderProgram = gradientResult.program;
        this.aGradientPosition = gradientResult.aGradientPosition;
        this.aGradientUV = gradientResult.aGradientUV;
        this.uGradientProjectionMatrix = gradientResult.uGradientProjectionMatrix;
        this.uGradientModelViewMatrix = gradientResult.uGradientModelViewMatrix;
        this.uGradientMatrix = gradientResult.uGradientMatrix;
        this.uGradientColors = gradientResult.uGradientColors;
        this.uGradientStops = gradientResult.uGradientStops;
        this.uGradientType = gradientResult.uGradientType;
        this.uGradientFocalPoint = gradientResult.uGradientFocalPoint;

        const bitmapResult = this.initBitmapShaders();
        this.bitmapShaderProgram = bitmapResult.program;
        this.aBitmapPosition = bitmapResult.aBitmapPosition;
        this.aBitmapUV = bitmapResult.aBitmapUV;
        this.uBitmapProjectionMatrix = bitmapResult.uBitmapProjectionMatrix;
        this.uBitmapModelViewMatrix = bitmapResult.uBitmapModelViewMatrix;
        this.uBitmapTexture = bitmapResult.uBitmapTexture;
        this.uBitmapMatrix = bitmapResult.uBitmapMatrix;
        
        const buffers = this.initBuffers();
        this.vertexBuffer = buffers.vertexBuffer;
        this.colorBuffer = buffers.colorBuffer;
        this.uvBuffer = buffers.uvBuffer;
        
        this.setupViewport();
    }

    private initSolidShaders(): {
        program: WebGLProgram;
        aVertexPosition: number;
        aVertexColor: number;
        uProjectionMatrix: WebGLUniformLocation;
        uModelViewMatrix: WebGLUniformLocation;
    } {
        const vertexShaderSource = `
            attribute vec2 aVertexPosition;
            attribute vec4 aVertexColor;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying vec4 vColor;

            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aVertexPosition, 0.0, 1.0);
                vColor = aVertexColor;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec4 vColor;

            void main() {
                gl_FragColor = vColor;
            }
        `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error('Erro ao linkar shaders: ' + this.gl.getProgramInfoLog(program));
        }

        this.gl.useProgram(program);

        // Get attribute and uniform locations
        const aVertexPosition = this.gl.getAttribLocation(program, 'aVertexPosition');
        const aVertexColor = this.gl.getAttribLocation(program, 'aVertexColor');
        const uProjectionMatrix = this.gl.getUniformLocation(program, 'uProjectionMatrix')!;
        const uModelViewMatrix = this.gl.getUniformLocation(program, 'uModelViewMatrix')!;

        this.gl.enableVertexAttribArray(aVertexPosition);
        this.gl.enableVertexAttribArray(aVertexColor);

        return { program, aVertexPosition, aVertexColor, uProjectionMatrix, uModelViewMatrix };
    }

    private initGradientShaders(): {
        program: WebGLProgram;
        aGradientPosition: number;
        aGradientUV: number;
        uGradientProjectionMatrix: WebGLUniformLocation;
        uGradientModelViewMatrix: WebGLUniformLocation;
        uGradientMatrix: WebGLUniformLocation;
        uGradientColors: WebGLUniformLocation;
        uGradientStops: WebGLUniformLocation;
        uGradientType: WebGLUniformLocation;
        uGradientFocalPoint: WebGLUniformLocation;
    } {
        const vertexShaderSource = `
            attribute vec2 aGradientPosition;
            attribute vec2 aGradientUV;
            uniform mat4 uGradientModelViewMatrix;
            uniform mat4 uGradientProjectionMatrix;
            varying vec2 vUV;

            void main() {
                gl_Position = uGradientProjectionMatrix * uGradientModelViewMatrix * vec4(aGradientPosition, 0.0, 1.0);
                vUV = aGradientUV;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 vUV;
            uniform vec4 uGradientColors[4];
            uniform float uGradientStops[4];
            uniform int uGradientType;
            uniform float uGradientFocalPoint;

            void main() {
                vec4 color = vec4(0.0);
                // Simple gradient shader logic
                if (uGradientType == 0) {
                    // Linear gradient
                    float pos = vUV.y * (uGradientStops[3] - uGradientStops[0]) + uGradientStops[0];
                    color = mix(uGradientColors[0], uGradientColors[1], pos);
                } else if (uGradientType == 1) {
                    // Radial gradient
                    float dist = length(vUV - vec2(0.5));
                    float pos = smoothstep(uGradientStops[0], uGradientStops[1], dist);
                    color = mix(uGradientColors[0], uGradientColors[3], pos);
                }
                gl_FragColor = color;
            }
        `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error('Erro ao linkar shaders: ' + this.gl.getProgramInfoLog(program));
        }

        this.gl.useProgram(program);

        // Get attribute and uniform locations
        const aGradientPosition = this.gl.getAttribLocation(program, 'aGradientPosition');
        const aGradientUV = this.gl.getAttribLocation(program, 'aGradientUV');
        const uGradientProjectionMatrix = this.gl.getUniformLocation(program, 'uGradientProjectionMatrix')!;
        const uGradientModelViewMatrix = this.gl.getUniformLocation(program, 'uGradientModelViewMatrix')!;
        const uGradientMatrix = this.gl.getUniformLocation(program, 'uGradientMatrix')!;
        const uGradientColors = this.gl.getUniformLocation(program, 'uGradientColors')!;
        const uGradientStops = this.gl.getUniformLocation(program, 'uGradientStops')!;
        const uGradientType = this.gl.getUniformLocation(program, 'uGradientType')!;
        const uGradientFocalPoint = this.gl.getUniformLocation(program, 'uGradientFocalPoint')!;

        this.gl.enableVertexAttribArray(aGradientPosition);
        this.gl.enableVertexAttribArray(aGradientUV);

        return { program, aGradientPosition, aGradientUV, uGradientProjectionMatrix, uGradientModelViewMatrix, uGradientMatrix, uGradientColors, uGradientStops, uGradientType, uGradientFocalPoint };
    }

    private initBitmapShaders(): {
        program: WebGLProgram;
        aBitmapPosition: number;
        aBitmapUV: number;
        uBitmapProjectionMatrix: WebGLUniformLocation;
        uBitmapModelViewMatrix: WebGLUniformLocation;
        uBitmapTexture: WebGLUniformLocation;
        uBitmapMatrix: WebGLUniformLocation;
    } {
        const vertexShaderSource = `
            attribute vec2 aBitmapPosition;
            attribute vec2 aBitmapUV;
            uniform mat4 uBitmapModelViewMatrix;
            uniform mat4 uBitmapProjectionMatrix;
            varying vec2 vUV;

            void main() {
                gl_Position = uBitmapProjectionMatrix * uBitmapModelViewMatrix * vec4(aBitmapPosition, 0.0, 1.0);
                vUV = aBitmapUV;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 vUV;
            uniform sampler2D uBitmapTexture;

            void main() {
                gl_FragColor = texture2D(uBitmapTexture, vUV);
            }
        `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error('Erro ao linkar shaders: ' + this.gl.getProgramInfoLog(program));
        }

        this.gl.useProgram(program);

        // Get attribute and uniform locations
        const aBitmapPosition = this.gl.getAttribLocation(program, 'aBitmapPosition');
        const aBitmapUV = this.gl.getAttribLocation(program, 'aBitmapUV');
        const uBitmapProjectionMatrix = this.gl.getUniformLocation(program, 'uBitmapProjectionMatrix')!;
        const uBitmapModelViewMatrix = this.gl.getUniformLocation(program, 'uBitmapModelViewMatrix')!;
        const uBitmapTexture = this.gl.getUniformLocation(program, 'uBitmapTexture')!;
        const uBitmapMatrix = this.gl.getUniformLocation(program, 'uBitmapMatrix')!;

        this.gl.enableVertexAttribArray(aBitmapPosition);
        this.gl.enableVertexAttribArray(aBitmapUV);

        return { program, aBitmapPosition, aBitmapUV, uBitmapProjectionMatrix, uBitmapModelViewMatrix, uBitmapTexture, uBitmapMatrix };
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const error = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error('Erro ao compilar shader: ' + error);
        }

        return shader;
    }

    private initBuffers(): { vertexBuffer: WebGLBuffer; colorBuffer: WebGLBuffer, uvBuffer: WebGLBuffer } {
        const vertexBuffer = this.gl.createBuffer()!;
        const colorBuffer = this.gl.createBuffer()!;
        const uvBuffer = this.gl.createBuffer()!;

        return { vertexBuffer, colorBuffer, uvBuffer };
    }

    private setupViewport() {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        // Enable blending for transparency
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        // Set clear color
        this.gl.clearColor(this.backgroundColor.r, this.backgroundColor.g, this.backgroundColor.b, this.backgroundColor.a);
    }

    setBackgroundColor(color: Color) {
        this.backgroundColor = color;
        this.gl.clearColor(color.r, color.g, color.b, color.a);
    }

    render(objects: RenderObject[]) {
        // Clear the canvas
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Sort objects by depth
        objects.sort((a, b) => a.depth - b.depth);

        // Set up projection matrix (orthographic)
        const projectionMatrix = this.createOrthographicMatrix(
            0, this.canvas.width,
            this.canvas.height, 0,
            -1000, 1000
        );

        this.gl.uniformMatrix4fv(this.uProjectionMatrix, false, projectionMatrix);

        // Render each object
        for (const obj of objects) {
            this.renderObject(obj);
        }
    }

    private triangulateShape(shape: Shape): { vertices: number[], colors: number[], uvs: number[], fillType: string } {
        const vertices: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        let fillType = 'solid';

        console.log(`Triangulating shape with ${shape.records.length} records, ${shape.fillStyles.length} fill styles`);

        // Convert shape records to paths
        const paths = this.shapeRecordsToPaths(shape);
        console.log(`Generated ${paths.length} paths from shape records`);

        // Triangulate each filled path
        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            console.log(`Path ${i}: ${path.points.length} points, fillStyle:`, path.fillStyle);
            
            if (path.fillStyle && path.points.length >= 3) {
                const triangles = this.earClippingTriangulation(path.points);
                const bounds = this.calculateBounds(path.points);
                
                // Determine fill type
                fillType = this.getFillType(path.fillStyle);
                
                console.log(`Generated ${triangles.length} triangles for path ${i}, fillType: ${fillType}`);

                for (const triangle of triangles) {
                    for (const point of triangle) {
                        vertices.push(point.x, point.y);
                        
                        // Add UV coordinates for gradients and bitmaps
                        if (fillType === 'gradient' || fillType === 'bitmap') {
                            const u = (point.x - bounds.xMin) / (bounds.xMax - bounds.xMin);
                            const v = (point.y - bounds.yMin) / (bounds.yMax - bounds.yMin);
                            uvs.push(u, v);
                        } else {
                            uvs.push(0, 0);
                        }
                        
                        // Add color data
                        const color = this.getFillColor(path.fillStyle, shape);
                        colors.push(color.r, color.g, color.b, color.a);
                    }
                }
            } else {
                console.log(`Skipping path ${i}: fillStyle=${!!path.fillStyle}, points=${path.points.length}`);
            }
        }

        console.log(`Final triangulation: ${vertices.length / 2} vertices, ${colors.length / 4} colors, fillType: ${fillType}`);
        return { vertices, colors, uvs, fillType };
    }

    private calculateBounds(points: Array<{x: number, y: number}>): { xMin: number, xMax: number, yMin: number, yMax: number } {
        if (points.length === 0) {
            return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
        }
        
        let xMin = points[0].x, xMax = points[0].x;
        let yMin = points[0].y, yMax = points[0].y;
        
        for (const point of points) {
            xMin = Math.min(xMin, point.x);
            xMax = Math.max(xMax, point.x);
            yMin = Math.min(yMin, point.y);
            yMax = Math.max(yMax, point.y);
        }
        
        return { xMin, xMax, yMin, yMax };
    }

    private getFillType(fillStyle: FillStyle): string {
        switch (fillStyle.type) {
            case 0x00: // Solid fill
                return 'solid';
            case 0x10: // Linear gradient
            case 0x12: // Radial gradient  
            case 0x13: // Focal radial gradient
                return 'gradient';
            case 0x40: // Repeating bitmap
            case 0x41: // Clipped bitmap
            case 0x42: // Non-smoothed repeating bitmap
            case 0x43: // Non-smoothed clipped bitmap
                return 'bitmap';
            default:
                return 'solid';
        }
    }

    private renderObject(obj: RenderObject) {
        const shape = obj.shape;
        
        // Triangulate the shape and get fill type
        const triangulation = this.triangulateShape(shape);
        
        if (triangulation.vertices.length === 0) {
            return; // Nothing to render
        }

        // Choose appropriate shader based on fill type
        switch (triangulation.fillType) {
            case 'solid':
                this.renderSolid(obj, triangulation);
                break;
            case 'gradient':
                this.renderGradient(obj, triangulation, shape);
                break;
            case 'bitmap':
                this.renderBitmap(obj, triangulation, shape);
                break;
        }
    }

    private renderSolid(obj: RenderObject, triangulation: any) {
        // Use solid color shader
        this.gl.useProgram(this.shaderProgram);
        
        // Set up matrices
        const projectionMatrix = this.createOrthographicMatrix(
            0, this.canvas.width,
            this.canvas.height, 0,
            -1000, 1000
        );
        const modelViewMatrix = this.createModelViewMatrix(obj.matrix);
        
        this.gl.uniformMatrix4fv(this.uProjectionMatrix, false, projectionMatrix);
        this.gl.uniformMatrix4fv(this.uModelViewMatrix, false, modelViewMatrix);

        // Enable vertex attributes
        this.gl.enableVertexAttribArray(this.aVertexPosition);
        this.gl.enableVertexAttribArray(this.aVertexColor);

        // Update vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.vertices), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aVertexPosition, 2, this.gl.FLOAT, false, 0, 0);

        // Update color buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.colorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.colors), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aVertexColor, 4, this.gl.FLOAT, false, 0, 0);

        // Validate data before drawing
        const vertexCount = triangulation.vertices.length / 2;
        const colorCount = triangulation.colors.length / 4;
        
        console.log(`Drawing ${vertexCount} vertices with ${colorCount} colors`);
        console.log('First few vertices:', triangulation.vertices.slice(0, 6));
        console.log('First few colors:', triangulation.colors.slice(0, 12));
        
        if (vertexCount !== colorCount) {
            console.error('Vertex/color count mismatch!', { vertexCount, colorCount });
            return;
        }
        
        if (vertexCount === 0) {
            console.warn('No vertices to draw');
            return;
        }

        // Draw triangles
        this.gl.drawArrays(this.gl.TRIANGLES, 0, vertexCount);
        
        // Check for WebGL errors
        const error = this.gl.getError();
        if (error !== this.gl.NO_ERROR) {
            console.error('WebGL error after drawing:', error);
        }
    }

    private renderGradient(obj: RenderObject, triangulation: any, shape: Shape) {
        // Use gradient shader
        this.gl.useProgram(this.gradientShaderProgram);
        
        // Set up matrices
        const projectionMatrix = this.createOrthographicMatrix(
            0, this.canvas.width,
            this.canvas.height, 0,
            -1000, 1000
        );
        const modelViewMatrix = this.createModelViewMatrix(obj.matrix);
        
        this.gl.uniformMatrix4fv(this.uGradientProjectionMatrix, false, projectionMatrix);
        this.gl.uniformMatrix4fv(this.uGradientModelViewMatrix, false, modelViewMatrix);

        // Get the first gradient fill style
        const gradientFill = shape.fillStyles.find(fs => fs.type >= 0x10 && fs.type <= 0x13);
        if (gradientFill && gradientFill.gradient) {
            this.setupGradientUniforms(gradientFill);
        }

        // Update vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.vertices), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aGradientPosition, 2, this.gl.FLOAT, false, 0, 0);

        // Update UV buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.uvBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.uvs), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aGradientUV, 2, this.gl.FLOAT, false, 0, 0);

        // Draw triangles
        this.gl.drawArrays(this.gl.TRIANGLES, 0, triangulation.vertices.length / 2);
    }

    private renderBitmap(obj: RenderObject, triangulation: any, shape: Shape) {
        // Use bitmap shader
        this.gl.useProgram(this.bitmapShaderProgram);
        
        // Set up matrices
        const projectionMatrix = this.createOrthographicMatrix(
            0, this.canvas.width,
            this.canvas.height, 0,
            -1000, 1000
        );
        const modelViewMatrix = this.createModelViewMatrix(obj.matrix);
        
        this.gl.uniformMatrix4fv(this.uBitmapProjectionMatrix, false, projectionMatrix);
        this.gl.uniformMatrix4fv(this.uBitmapModelViewMatrix, false, modelViewMatrix);

        // Get the first bitmap fill style
        const bitmapFill = shape.fillStyles.find(fs => fs.type >= 0x40 && fs.type <= 0x43);
        if (bitmapFill && bitmapFill.bitmapId) {
            const texture = this.textures.get(bitmapFill.bitmapId);
            if (texture) {
                this.gl.activeTexture(this.gl.TEXTURE0);
                this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
                this.gl.uniform1i(this.uBitmapTexture, 0);
            }
        }

        // Update vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.vertices), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aBitmapPosition, 2, this.gl.FLOAT, false, 0, 0);

        // Update UV buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.uvBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(triangulation.uvs), this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aBitmapUV, 2, this.gl.FLOAT, false, 0, 0);

        // Draw triangles
        this.gl.drawArrays(this.gl.TRIANGLES, 0, triangulation.vertices.length / 2);
    }

    private setupGradientUniforms(fillStyle: FillStyle) {
        if (!fillStyle.gradient) return;

        const gradient = fillStyle.gradient;
        
        // Set gradient type
        let gradientType = 0;
        switch (fillStyle.type) {
            case 0x10: gradientType = 0; break; // Linear
            case 0x12: gradientType = 1; break; // Radial
            case 0x13: gradientType = 2; break; // Focal radial
        }
        this.gl.uniform1i(this.uGradientType, gradientType);

        // Set focal point for focal radial gradients
        if (fillStyle.type === 0x13 && gradient.focalPoint !== undefined) {
            this.gl.uniform1f(this.uGradientFocalPoint, gradient.focalPoint);
        } else {
            this.gl.uniform1f(this.uGradientFocalPoint, 0.0);
        }

        // Prepare gradient colors and stops
        const colors: number[] = [];
        const stops: number[] = [];
        
        for (let i = 0; i < Math.min(4, gradient.gradientRecords.length); i++) {
            const record = gradient.gradientRecords[i] || { ratio: 0, color: { r: 0, g: 0, b: 0, a: 1 } };
            colors.push(record.color.r, record.color.g, record.color.b, record.color.a);
            stops.push(record.ratio / 255.0);
        }

        // Pad arrays to 4 elements
        while (colors.length < 16) colors.push(0);
        while (stops.length < 4) stops.push(0);

        this.gl.uniform4fv(this.uGradientColors, colors);
        this.gl.uniform1fv(this.uGradientStops, stops);
    }

    // Method to load bitmap texture
    loadBitmapTexture(bitmapId: number, imageData: ImageData | HTMLImageElement | HTMLCanvasElement): WebGLTexture {
        const texture = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        // Upload texture data
        if (imageData instanceof ImageData) {
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData);
        } else {
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData);
        }

        this.textures.set(bitmapId, texture);
        return texture;
    }

    private getFillColor(fillStyle: FillStyle, shape: Shape): Color {
        if (!fillStyle) {
            return { r: 0, g: 0, b: 0, a: 1 };
        }

        // Handle solid colors
        if (fillStyle.color) {
            return fillStyle.color;
        }

        // Handle gradients - return first gradient color as fallback
        if (fillStyle.gradient && fillStyle.gradient.gradientRecords.length > 0) {
            return fillStyle.gradient.gradientRecords[0].color;
        }

        // Default fallback color
        return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
    }

    private createOrthographicMatrix(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
        const matrix = new Float32Array(16);
        
        matrix[0] = 2 / (right - left);
        matrix[1] = 0;
        matrix[2] = 0;
        matrix[3] = 0;
        
        matrix[4] = 0;
        matrix[5] = 2 / (top - bottom);
        matrix[6] = 0;
        matrix[7] = 0;
        
        matrix[8] = 0;
        matrix[9] = 0;
        matrix[10] = -2 / (far - near);
        matrix[11] = 0;
        
        matrix[12] = -(right + left) / (right - left);
        matrix[13] = -(top + bottom) / (top - bottom);
        matrix[14] = -(far + near) / (far - near);
        matrix[15] = 1;
        
        return matrix;
    }

    private createModelViewMatrix(transform?: Matrix): Float32Array {
        const matrix = new Float32Array(16);
        
        // Initialize as identity matrix
        matrix[0] = 1; matrix[4] = 0; matrix[8] = 0;  matrix[12] = 0;
        matrix[1] = 0; matrix[5] = 1; matrix[9] = 0;  matrix[13] = 0;
        matrix[2] = 0; matrix[6] = 0; matrix[10] = 1; matrix[14] = 0;
        matrix[3] = 0; matrix[7] = 0; matrix[11] = 0; matrix[15] = 1;

        if (transform) {
            // Apply transformation matrix
            matrix[0] = transform.scaleX;
            matrix[1] = transform.rotateSkew0;
            matrix[4] = transform.rotateSkew1;
            matrix[5] = transform.scaleY;
            matrix[12] = transform.translateX / 20; // Convert twips to pixels
            matrix[13] = transform.translateY / 20;
        }

        return matrix;
    }

    private shapeRecordsToPaths(shape: Shape): Array<{ points: Array<{x: number, y: number}>, fillStyle?: any, lineStyle?: any }> {
        const paths: Array<{ points: Array<{x: number, y: number}>, fillStyle?: any, lineStyle?: any }> = [];
        let currentPath: Array<{x: number, y: number}> = [];
        let currentX = 0;
        let currentY = 0;
        let currentFillStyle0: any = null;
        let currentFillStyle1: any = null;
        let currentLineStyle: any = null;

        console.log(`Processing ${shape.records.length} shape records`);

        for (const record of shape.records) {
            console.log(`Processing record:`, record);
            
            switch (record.type) {
                case 'styleChange':
                    // Finish current path if we have points
                    if (currentPath.length > 0) {
                        // Use fillStyle0 (left fill) as primary fill
                        const fillStyle = currentFillStyle0 || currentFillStyle1;
                        if (fillStyle) {
                            paths.push({
                                points: [...currentPath],
                                fillStyle: fillStyle,
                                lineStyle: currentLineStyle
                            });
                            console.log(`Added path with ${currentPath.length} points and fill style:`, fillStyle);
                        }
                        currentPath = [];
                    }

                    if (record.moveTo) {
                        currentX = record.moveTo.x / 20; // Convert twips to pixels
                        currentY = record.moveTo.y / 20;
                        currentPath = [{ x: currentX, y: currentY }];
                        console.log(`MoveTo: (${currentX}, ${currentY})`);
                    }

                    // Handle fill style changes
                    if (record.fillStyle0 !== undefined) {
                        if (record.fillStyle0 === 0) {
                            currentFillStyle0 = null;
                        } else {
                            currentFillStyle0 = shape.fillStyles[record.fillStyle0 - 1] || null;
                            console.log(`Set fillStyle0 to:`, currentFillStyle0);
                        }
                    }

                    if (record.fillStyle1 !== undefined) {
                        if (record.fillStyle1 === 0) {
                            currentFillStyle1 = null;
                        } else {
                            currentFillStyle1 = shape.fillStyles[record.fillStyle1 - 1] || null;
                            console.log(`Set fillStyle1 to:`, currentFillStyle1);
                        }
                    }

                    if (record.lineStyle !== undefined) {
                        if (record.lineStyle === 0) {
                            currentLineStyle = null;
                        } else {
                            currentLineStyle = shape.lineStyles[record.lineStyle - 1] || null;
                            console.log(`Set lineStyle to:`, currentLineStyle);
                        }
                    }
                    break;

                case 'straightEdge':
                    if (record.lineTo) {
                        currentX = record.lineTo.x / 20;
                        currentY = record.lineTo.y / 20;
                        currentPath.push({ x: currentX, y: currentY });
                        console.log(`LineTo: (${currentX}, ${currentY})`);
                    }
                    break;

                case 'curvedEdge':
                    if (record.curveTo) {
                        // Better curve approximation with adaptive segments
                        const controlX = record.curveTo.controlX / 20;
                        const controlY = record.curveTo.controlY / 20;
                        const anchorX = record.curveTo.anchorX / 20;
                        const anchorY = record.curveTo.anchorY / 20;

                        // Calculate curve length to determine number of segments
                        const dx1 = controlX - currentX;
                        const dy1 = controlY - currentY;
                        const dx2 = anchorX - controlX;
                        const dy2 = anchorY - controlY;
                        const curveLength = Math.sqrt(dx1*dx1 + dy1*dy1) + Math.sqrt(dx2*dx2 + dy2*dy2);
                        const segments = Math.max(4, Math.min(20, Math.ceil(curveLength / 10)));

                        for (let i = 1; i <= segments; i++) {
                            const t = i / segments;
                            const x = (1 - t) * (1 - t) * currentX + 2 * (1 - t) * t * controlX + t * t * anchorX;
                            const y = (1 - t) * (1 - t) * currentY + 2 * (1 - t) * t * controlY + t * t * anchorY;
                            currentPath.push({ x, y });
                        }

                        currentX = anchorX;
                        currentY = anchorY;
                        console.log(`CurveTo: control(${controlX}, ${controlY}) anchor(${currentX}, ${currentY})`);
                    }
                    break;
            }
        }

        // Add final path
        if (currentPath.length > 0) {
            const fillStyle = currentFillStyle0 || currentFillStyle1;
            if (fillStyle) {
                paths.push({
                    points: currentPath,
                    fillStyle: fillStyle,
                    lineStyle: currentLineStyle
                });
                console.log(`Added final path with ${currentPath.length} points`);
            }
        }

        console.log(`Generated ${paths.length} paths from shape records`);
        return paths;
    }

    private earClippingTriangulation(points: Array<{x: number, y: number}>): Array<Array<{x: number, y: number}>> {
        if (points.length < 3) return [];

        // Remove duplicate points
        const cleanPoints = this.removeDuplicatePoints(points);
        if (cleanPoints.length < 3) return [];

        const triangles: Array<Array<{x: number, y: number}>> = [];
        const vertices = [...cleanPoints];

        // Ensure counter-clockwise winding
        if (this.isClockwise(vertices)) {
            vertices.reverse();
        }

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
                // Fallback: create triangle fan from first vertex
                console.warn('Ear clipping failed, using triangle fan');
                const center = vertices[0];
                for (let i = 1; i < vertices.length - 1; i++) {
                    triangles.push([center, vertices[i], vertices[i + 1]]);
                }
                break;
            }
        }

        if (vertices.length === 3) {
            triangles.push([vertices[0], vertices[1], vertices[2]]);
        }

        return triangles;
    }

    private removeDuplicatePoints(points: Array<{x: number, y: number}>): Array<{x: number, y: number}> {
        const cleaned: Array<{x: number, y: number}> = [];
        const epsilon = 0.001; // Small tolerance for floating point comparison

        for (const point of points) {
            const isDuplicate = cleaned.some(existing => 
                Math.abs(existing.x - point.x) < epsilon && 
                Math.abs(existing.y - point.y) < epsilon
            );
            
            if (!isDuplicate) {
                cleaned.push(point);
            }
        }

        return cleaned;
    }

    private isClockwise(points: Array<{x: number, y: number}>): boolean {
        let sum = 0;
        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const next = points[(i + 1) % points.length];
            sum += (next.x - curr.x) * (next.y + curr.y);
        }
        return sum > 0;
    }

    private isEar(prev: {x: number, y: number}, curr: {x: number, y: number}, next: {x: number, y: number}, vertices: Array<{x: number, y: number}>): boolean {
        // Check if the triangle is convex (ear tip test)
        const cross = (next.x - curr.x) * (prev.y - curr.y) - (next.y - curr.y) * (prev.x - curr.x);
        if (cross <= 0) return false; // Not convex or degenerate

        // Check if any other vertex is inside the triangle
        for (const vertex of vertices) {
            if (vertex === prev || vertex === curr || vertex === next) continue;
            if (this.pointInTriangle(vertex, prev, curr, next)) {
                return false;
            }
        }

        return true;
    }

    private pointInTriangle(p: {x: number, y: number}, a: {x: number, y: number}, b: {x: number, y: number}, c: {x: number, y: number}): boolean {
        const sign = (p1: {x: number, y: number}, p2: {x: number, y: number}, p3: {x: number, y: number}) => {
            return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
        };

        const d1 = sign(p, a, b);
        const d2 = sign(p, b, c);
        const d3 = sign(p, c, a);

        const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
        const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);

        return !(hasNeg && hasPos);
    }

    destroy() {
        // Clean up all WebGL resources
        if (this.vertexBuffer) {
            this.gl.deleteBuffer(this.vertexBuffer);
        }
        if (this.colorBuffer) {
            this.gl.deleteBuffer(this.colorBuffer);
        }
        if (this.uvBuffer) {
            this.gl.deleteBuffer(this.uvBuffer);
        }
        
        // Clean up shader programs
        if (this.shaderProgram) {
            this.gl.deleteProgram(this.shaderProgram);
        }
        if (this.gradientShaderProgram) {
            this.gl.deleteProgram(this.gradientShaderProgram);
        }
        if (this.bitmapShaderProgram) {
            this.gl.deleteProgram(this.bitmapShaderProgram);
        }
        
        // Clean up textures
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.textures.clear();
    }
}
