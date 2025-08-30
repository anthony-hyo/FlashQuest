import {DisplayObject, FillStyle, LineStyle, ShapeRecord} from "../index";

export class WebGLRenderer {
    public readonly gl: WebGLRenderingContext;
    private program!: WebGLProgram;
    private positionBuffer!: WebGLBuffer;
    private positionLocation!: number;
    private resolutionLocation!: WebGLUniformLocation;
    private colorLocation!: WebGLUniformLocation;

    constructor(private canvas: HTMLCanvasElement) {
        this.gl = canvas.getContext('webgl')!;
        
        if (!this.gl) {
            throw new Error("WebGL not supported");
        }

        this.initShaders();
        this.initBuffers();
        this.setupGL();
    }

    initShaders() {
        const vsSource = `
                    attribute vec2 a_position;
                    uniform vec2 u_resolution;
                    void main() {
                        vec2 zeroToOne = a_position / u_resolution;
                        vec2 zeroToTwo = zeroToOne * 2.0;
                        vec2 clipSpace = zeroToTwo - 1.0;
                        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                    }
                `;

        const fsSource = `
                    precision mediump float;
                    uniform vec4 u_color;
                    void main() {
                        gl_FragColor = u_color;
                    }
                `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource)!;
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource)!;
        this.program = this.createProgram(vertexShader, fragmentShader)!;

        this.positionLocation = this.gl.getAttribLocation(this.program, "a_position");
        this.resolutionLocation = this.gl.getUniformLocation(this.program, "u_resolution")!;
        this.colorLocation = this.gl.getUniformLocation(this.program, "u_color")!;
    }

    initBuffers() {
        this.positionBuffer = this.gl.createBuffer();
    }

    setupGL() {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.useProgram(this.program);
        this.gl.enableVertexAttribArray(this.positionLocation);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
    }

    createShader(type: number, source: string) {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            return shader;
        }
        console.error(this.gl.getShaderInfoLog(shader));
        this.gl.deleteShader(shader);
        return null;
    }

    createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        if (this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            return program;
        }
        console.error(this.gl.getProgramInfoLog(program));
        this.gl.deleteProgram(program);
        return null;
    }

    clear() {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    drawRect(x: any, y: any, width: any, height: any, color: { r: number; g: number; b: number; a: number; }) {
        this.gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        this.gl.uniform4f(this.colorLocation, color.r, color.g, color.b, color.a);

        const x1 = x;
        const x2 = x + width;
        const y1 = y;
        const y2 = y + height;

        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            x1, y1,
            x2, y1,
            x1, y2,
            x1, y2,
            x2, y1,
            x2, y2,
        ]), this.gl.STATIC_DRAW);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }

    draw(displayList: DisplayObject[]) {
        this.clear();
        displayList.forEach(obj => {
            this.drawRect(obj.x, obj.y, obj.width, obj.height, obj.color!);
        });
    }
    
}