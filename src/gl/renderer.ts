import { Shape, Color, FillStyle } from '../swf/shapes';
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

    // Shader programs
    private shaderProgram: WebGLProgram;          // solid
    private gradientShaderProgram: WebGLProgram;  // gradient
    private bitmapShaderProgram: WebGLProgram;    // bitmap

    // Buffers
    private vertexBuffer: WebGLBuffer;
    private colorBuffer: WebGLBuffer;
    private uvBuffer: WebGLBuffer;

    private backgroundColor: Color = { r: 1, g: 1, b: 1, a: 1 };

    // Solid shader attribs/uniforms
    private aVertexPosition: number;
    private aVertexColor: number;
    private uProjectionMatrix: WebGLUniformLocation;
    private uModelViewMatrix: WebGLUniformLocation;

    // Gradient shader attribs/uniforms
    private aGradientPosition: number;
    private aGradientUV: number;
    private uGradientProjectionMatrix: WebGLUniformLocation;
    private uGradientModelViewMatrix: WebGLUniformLocation;
    private uGradientColors: WebGLUniformLocation;
    private uGradientStops: WebGLUniformLocation;
    private uGradientType: WebGLUniformLocation;
    private uGradientFocalPoint: WebGLUniformLocation;

    // Bitmap shader attribs/uniforms
    private aBitmapPosition: number;
    private aBitmapUV: number;
    private uBitmapProjectionMatrix: WebGLUniformLocation;
    private uBitmapModelViewMatrix: WebGLUniformLocation;
    private uBitmapTexture: WebGLUniformLocation;

    // Textures cache
    private textures: Map<number, WebGLTexture> = new Map();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('WebGL não suportado');
        this.gl = gl as WebGLRenderingContext;

        // Init shaders
        const solid = this.initSolidShaders();
        this.shaderProgram = solid.program;
        this.aVertexPosition = solid.aVertexPosition;
        this.aVertexColor = solid.aVertexColor;
        this.uProjectionMatrix = solid.uProjectionMatrix;
        this.uModelViewMatrix = solid.uModelViewMatrix;

        const grad = this.initGradientShaders();
        this.gradientShaderProgram = grad.program;
        this.aGradientPosition = grad.aGradientPosition;
        this.aGradientUV = grad.aGradientUV;
        this.uGradientProjectionMatrix = grad.uGradientProjectionMatrix;
        this.uGradientModelViewMatrix = grad.uGradientModelViewMatrix;
        this.uGradientColors = grad.uGradientColors;
        this.uGradientStops = grad.uGradientStops;
        this.uGradientType = grad.uGradientType;
        this.uGradientFocalPoint = grad.uGradientFocalPoint;

        const bmp = this.initBitmapShaders();
        this.bitmapShaderProgram = bmp.program;
        this.aBitmapPosition = bmp.aBitmapPosition;
        this.aBitmapUV = bmp.aBitmapUV;
        this.uBitmapProjectionMatrix = bmp.uBitmapProjectionMatrix;
        this.uBitmapModelViewMatrix = bmp.uBitmapModelViewMatrix;
        this.uBitmapTexture = bmp.uBitmapTexture;

        // Buffers
        const buffers = this.initBuffers();
        this.vertexBuffer = buffers.vertexBuffer;
        this.colorBuffer = buffers.colorBuffer;
        this.uvBuffer = buffers.uvBuffer;

        this.setupViewport();
    }

    // ---------------- Shader Creation ----------------
    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + info);
        }
        return shader;
    }

    private initSolidShaders() {
        const vs = `attribute vec2 aVertexPosition;\nattribute vec4 aVertexColor;\nuniform mat4 uModelViewMatrix;\nuniform mat4 uProjectionMatrix;\nvarying vec4 vColor;\nvoid main(){gl_Position=uProjectionMatrix*uModelViewMatrix*vec4(aVertexPosition,0.0,1.0);vColor=aVertexColor;}`;
        const fs = `precision mediump float;\nvarying vec4 vColor;\nvoid main(){gl_FragColor=vColor;}`;
        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, this.createShader(this.gl.VERTEX_SHADER, vs));
        this.gl.attachShader(program, this.createShader(this.gl.FRAGMENT_SHADER, fs));
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) throw new Error('Link error');
        this.gl.useProgram(program);
        const aVertexPosition = this.gl.getAttribLocation(program, 'aVertexPosition');
        const aVertexColor = this.gl.getAttribLocation(program, 'aVertexColor');
        const uProjectionMatrix = this.gl.getUniformLocation(program, 'uProjectionMatrix')!;
        const uModelViewMatrix = this.gl.getUniformLocation(program, 'uModelViewMatrix')!;
        this.gl.enableVertexAttribArray(aVertexPosition);
        this.gl.enableVertexAttribArray(aVertexColor);
        return { program, aVertexPosition, aVertexColor, uProjectionMatrix, uModelViewMatrix };
    }

    private initGradientShaders() {
        const vs = `attribute vec2 aGradientPosition;attribute vec2 aGradientUV;uniform mat4 uGradientModelViewMatrix;uniform mat4 uGradientProjectionMatrix;varying vec2 vUV;void main(){gl_Position=uGradientProjectionMatrix*uGradientModelViewMatrix*vec4(aGradientPosition,0.0,1.0);vUV=aGradientUV;}`;
        const fs = `precision mediump float;varying vec2 vUV;uniform vec4 uGradientColors[4];uniform float uGradientStops[4];uniform int uGradientType;uniform float uGradientFocalPoint;void main(){vec4 color=vec4(0.0);if(uGradientType==0){float pos=vUV.y*(uGradientStops[3]-uGradientStops[0])+uGradientStops[0];color=mix(uGradientColors[0],uGradientColors[1],pos);}else if(uGradientType==1){float dist=length(vUV-vec2(0.5));float pos=smoothstep(uGradientStops[0],uGradientStops[1],dist);color=mix(uGradientColors[0],uGradientColors[3],pos);}gl_FragColor=color;}`;
        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, this.createShader(this.gl.VERTEX_SHADER, vs));
        this.gl.attachShader(program, this.createShader(this.gl.FRAGMENT_SHADER, fs));
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) throw new Error('Link error');
        this.gl.useProgram(program);
        const aGradientPosition = this.gl.getAttribLocation(program, 'aGradientPosition');
        const aGradientUV = this.gl.getAttribLocation(program, 'aGradientUV');
        const uGradientProjectionMatrix = this.gl.getUniformLocation(program, 'uGradientProjectionMatrix')!;
        const uGradientModelViewMatrix = this.gl.getUniformLocation(program, 'uGradientModelViewMatrix')!;
        const uGradientColors = this.gl.getUniformLocation(program, 'uGradientColors')!;
        const uGradientStops = this.gl.getUniformLocation(program, 'uGradientStops')!;
        const uGradientType = this.gl.getUniformLocation(program, 'uGradientType')!;
        const uGradientFocalPoint = this.gl.getUniformLocation(program, 'uGradientFocalPoint')!;
        this.gl.enableVertexAttribArray(aGradientPosition);
        this.gl.enableVertexAttribArray(aGradientUV);
        return { program, aGradientPosition, aGradientUV, uGradientProjectionMatrix, uGradientModelViewMatrix, uGradientColors, uGradientStops, uGradientType, uGradientFocalPoint };
    }

    private initBitmapShaders() {
        const vs = `attribute vec2 aBitmapPosition;attribute vec2 aBitmapUV;uniform mat4 uBitmapModelViewMatrix;uniform mat4 uBitmapProjectionMatrix;varying vec2 vUV;void main(){gl_Position=uBitmapProjectionMatrix*uBitmapModelViewMatrix*vec4(aBitmapPosition,0.0,1.0);vUV=aBitmapUV;}`;
        const fs = `precision mediump float;varying vec2 vUV;uniform sampler2D uBitmapTexture;void main(){gl_FragColor=texture2D(uBitmapTexture,vUV);}`;
        const program = this.gl.createProgram()!;
        this.gl.attachShader(program, this.createShader(this.gl.VERTEX_SHADER, vs));
        this.gl.attachShader(program, this.createShader(this.gl.FRAGMENT_SHADER, fs));
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) throw new Error('Link error');
        this.gl.useProgram(program);
        const aBitmapPosition = this.gl.getAttribLocation(program, 'aBitmapPosition');
        const aBitmapUV = this.gl.getAttribLocation(program, 'aBitmapUV');
        const uBitmapProjectionMatrix = this.gl.getUniformLocation(program, 'uBitmapProjectionMatrix')!;
        const uBitmapModelViewMatrix = this.gl.getUniformLocation(program, 'uBitmapModelViewMatrix')!;
        const uBitmapTexture = this.gl.getUniformLocation(program, 'uBitmapTexture')!;
        this.gl.enableVertexAttribArray(aBitmapPosition);
        this.gl.enableVertexAttribArray(aBitmapUV);
        return { program, aBitmapPosition, aBitmapUV, uBitmapProjectionMatrix, uBitmapModelViewMatrix, uBitmapTexture };
    }

    // ---------------- Buffers & Viewport ----------------
    private initBuffers() { return { vertexBuffer: this.gl.createBuffer()!, colorBuffer: this.gl.createBuffer()!, uvBuffer: this.gl.createBuffer()! }; }

    private setupViewport() {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gl.clearColor(this.backgroundColor.r, this.backgroundColor.g, this.backgroundColor.b, this.backgroundColor.a);
    }

    setBackgroundColor(color: Color) { this.backgroundColor = color; this.gl.clearColor(color.r, color.g, color.b, color.a); }

    // ---------------- Render Loop ----------------
    render(objects: RenderObject[]) {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        objects.sort((a,b)=>a.depth-b.depth);
        const projection = this.createOrthographicMatrix(0, this.canvas.width, this.canvas.height, 0, -1000, 1000);
        this.gl.useProgram(this.shaderProgram); // ensure some program bound for uniform location
        this.gl.uniformMatrix4fv(this.uProjectionMatrix, false, projection);
        for (const obj of objects) this.renderObject(obj);
    }

    private renderObject(obj: RenderObject) {
        const tri = this.triangulateShape(obj.shape);
        if (!tri.vertices.length) return;
        if (tri.fillType === 'solid') this.renderSolid(obj, tri); else if (tri.fillType === 'gradient') this.renderGradient(obj, tri, obj.shape); else this.renderBitmap(obj, tri, obj.shape);
    }

    private renderSolid(obj: RenderObject, tri: {vertices:number[];colors:number[]}) {
        this.gl.useProgram(this.shaderProgram);
        const mv = this.createModelViewMatrix(obj.matrix);
        const proj = this.createOrthographicMatrix(0, this.canvas.width, this.canvas.height, 0, -1000, 1000);
        this.gl.uniformMatrix4fv(this.uProjectionMatrix,false,proj);
        this.gl.uniformMatrix4fv(this.uModelViewMatrix,false,mv);
        // vertices
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(tri.vertices),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aVertexPosition,2,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aVertexPosition);
        // colors
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.colorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(tri.colors),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aVertexColor,4,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aVertexColor);
        this.gl.drawArrays(this.gl.TRIANGLES,0,tri.vertices.length/2);
    }

    private renderGradient(obj: RenderObject, tri: {vertices:number[];uvs?:number[]}, shape: Shape) {
        this.gl.useProgram(this.gradientShaderProgram);
        const mv = this.createModelViewMatrix(obj.matrix);
        const proj = this.createOrthographicMatrix(0,this.canvas.width,this.canvas.height,0,-1000,1000);
        this.gl.uniformMatrix4fv(this.uGradientProjectionMatrix,false,proj);
        this.gl.uniformMatrix4fv(this.uGradientModelViewMatrix,false,mv);
        const fs = shape.fillStyles.find(f=>f.type>=0x10&&f.type<=0x13);
        if (fs) this.setupGradientUniforms(fs);
        // vertices
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(tri.vertices),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aGradientPosition,2,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aGradientPosition);
        // uvs
        const uvs = tri.uvs || new Array((tri.vertices.length/2)*2).fill(0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.uvBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(uvs),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aGradientUV,2,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aGradientUV);
        this.gl.drawArrays(this.gl.TRIANGLES,0,tri.vertices.length/2);
    }

    private renderBitmap(obj: RenderObject, tri: {vertices:number[];uvs?:number[]}, shape: Shape) {
        this.gl.useProgram(this.bitmapShaderProgram);
        const mv = this.createModelViewMatrix(obj.matrix);
        const proj = this.createOrthographicMatrix(0,this.canvas.width, this.canvas.height, 0, -1000, 1000);
        this.gl.uniformMatrix4fv(this.uBitmapProjectionMatrix,false,proj);
        this.gl.uniformMatrix4fv(this.uBitmapModelViewMatrix,false,mv);
        const fs = shape.fillStyles.find(f=>f.type>=0x40&&f.type<=0x43);
        if (fs?.bitmapId) {
            const tex = this.textures.get(fs.bitmapId);
            if (tex) { this.gl.activeTexture(this.gl.TEXTURE0); this.gl.bindTexture(this.gl.TEXTURE_2D,tex); this.gl.uniform1i(this.uBitmapTexture,0); }
        }
        const uvs = tri.uvs || new Array((tri.vertices.length/2)*2).fill(0);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(tri.vertices),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aBitmapPosition,2,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aBitmapPosition);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.uvBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(uvs),this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.aBitmapUV,2,this.gl.FLOAT,false,0,0);
        this.gl.enableVertexAttribArray(this.aBitmapUV);
        this.gl.drawArrays(this.gl.TRIANGLES,0,tri.vertices.length/2);
    }

    private setupGradientUniforms(fs: FillStyle) {
        if (!fs.gradient) return;
        let type = 0; if (fs.type===0x12) type=1; else if (fs.type===0x13) type=2;
        this.gl.uniform1i(this.uGradientType,type);
        this.gl.uniform1f(this.uGradientFocalPoint, fs.gradient.focalPoint??0);
        const colors:number[]=[]; const stops:number[]=[];
        for (let i=0;i<Math.min(4,fs.gradient.gradientRecords.length);i++){const rec=fs.gradient.gradientRecords[i];colors.push(rec.color.r,rec.color.g,rec.color.b,rec.color.a);stops.push(rec.ratio/255);} 
        while(colors.length<16) colors.push(0,0,0,1);
        while(stops.length<4) stops.push(stops[stops.length-1]??0);
        this.gl.uniform4fv(this.uGradientColors,new Float32Array(colors));
        this.gl.uniform1fv(this.uGradientStops,new Float32Array(stops));
    }

    // ---------------- Triangulation & Shape Processing ----------------
    private triangulateShape(shape: Shape) {
        const paths = this.shapeRecordsToPaths(shape);
        const vertices:number[]=[]; const colors:number[]=[]; const uvs:number[]=[];
        let fillType = 'solid';

        for (const path of paths){
            if (path.points.length < 3 || !path.fillStyle) continue;

            // Ensure path is closed for triangulation.
            const firstPoint = path.points[0];
            const lastPoint = path.points[path.points.length - 1];
            if (Math.abs(firstPoint.x - lastPoint.x) > 0.001 || Math.abs(firstPoint.y - lastPoint.y) > 0.001) {
                path.points.push({ ...firstPoint });
            }

            // Triangulation of the fill.
            const triangles = this.earClippingTriangulation(path.points);
            fillType = this.getFillType(path.fillStyle);
            const bounds = this.calculateBounds(path.points);
            
            // If ear clipping fails, fallback to a simple quad from the shape's bounding box.
            const effectiveTriangles = triangles.length ? triangles : this.boundsFallback(bounds);
            const filteredTriangles = effectiveTriangles.filter(t => this.triangleArea(t[0], t[1], t[2]) > 0.01);
            const color = this.getFillColor(path.fillStyle);

            for (const tri of filteredTriangles) {
                for (const p of tri) {
                    vertices.push(p.x, p.y);
                    if (fillType === 'gradient' || fillType === 'bitmap') {
                        const u = (p.x - bounds.xMin) / (bounds.xMax - bounds.xMin || 1);
                        const v = (p.y - bounds.yMin) / (bounds.yMax - bounds.yMin || 1);
                        uvs.push(u, v);
                    } else {
                        uvs.push(0, 0);
                    }
                    // FIX: Use 'color' not 'col'
                    colors.push(color.r, color.g, color.b, color.a);
                }
            }

            // --- BEGIN NEW: Line Rendering ---
            if (path.lineStyle && path.lineStyle.width > 0) {
                const lineColor = path.lineStyle.color;
                // Create line segments from the path points.
                for (let i = 0; i < path.points.length - 1; i++) {
                    const p1 = path.points[i];
                    const p2 = path.points[i+1];
                    
                    // For simplicity, this renders a thin line as two triangles.
                    // A robust implementation would use a geometry shader or expand the line based on its width.
                    const thickness = path.lineStyle.width / 40; // Approximate thickness
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.sqrt(dx*dx + dy*dy);
                    const nx = -dy / len * thickness;
                    const ny = dx / len * thickness;

                    const v1 = {x: p1.x - nx, y: p1.y - ny};
                    const v2 = {x: p2.x - nx, y: p2.y - ny};
                    const v3 = {x: p1.x + nx, y: p1.y + ny};
                    const v4 = {x: p2.x + nx, y: p2.y + ny};

                    // Triangle 1
                    vertices.push(v1.x, v1.y, v2.x, v2.y, v3.x, v3.y);
                    // Triangle 2
                    vertices.push(v3.x, v3.y, v2.x, v2.y, v4.x, v4.y);

                    for (let j=0; j<6; j++) {
                        colors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.a);
                        uvs.push(0,0); // No UVs for solid lines
                    }
                }
            }
            // --- END NEW: Line Rendering ---
        }
        return { vertices, colors, uvs, fillType };
    }

    private boundsFallback(b:{xMin:number,xMax:number,yMin:number,yMax:number}) { return [[{x:b.xMin,y:b.yMin},{x:b.xMax,y:b.yMin},{x:b.xMax,y:b.yMax}],[{x:b.xMin,y:b.yMin},{x:b.xMax,y:b.yMax},{x:b.xMin,y:b.yMax}]]; }

    private shapeRecordsToPaths(shape: Shape) {
        const paths: Array<{points:{x:number,y:number}[]; fillStyle?:FillStyle; lineStyle?:any}> = [];
        let currentPath:{x:number,y:number}[]=[]; 
        let currentX=0, currentY=0; 
        let currentFillStyle0:FillStyle|null=null;
        let currentFillStyle1:FillStyle|null=null;
        let currentLineStyle:any=null;

        const pushPath = () => {
            if (currentPath.length > 1) {
                // A path can have a fill, a line, or both.
                // We create a separate path object for the fill and the line if both exist.
                const fillStyle = currentFillStyle0 || currentFillStyle1;
                if (fillStyle) {
                    paths.push({ points: [...currentPath], fillStyle: fillStyle, lineStyle: null });
                }
                if (currentLineStyle) {
                    paths.push({ points: [...currentPath], fillStyle: null, lineStyle: currentLineStyle });
                }
            }
            currentPath = [];
        };

        for (const rec of shape.records){
            switch(rec.type){
                case 'styleChange':
                    // A style change can signal the end of the current path.
                    pushPath();
                    
                    if(rec.moveTo){
                        currentX = rec.moveTo.x / 20;
                        currentY = rec.moveTo.y / 20;
                        currentPath.push({x: currentX, y: currentY});
                    }
                    if(rec.fillStyle0 !== undefined) {
                        currentFillStyle0 = rec.fillStyle0 === 0 ? null : shape.fillStyles[rec.fillStyle0 - 1];
                    }
                    if(rec.fillStyle1 !== undefined) {
                        currentFillStyle1 = rec.fillStyle1 === 0 ? null : shape.fillStyles[rec.fillStyle1 - 1];
                    }
                    if(rec.lineStyle !== undefined) {
                        currentLineStyle = rec.lineStyle === 0 ? null : shape.lineStyles[rec.lineStyle - 1];
                    }
                    break;
                case 'straightEdge':
                    if(rec.lineTo){currentX=rec.lineTo.x/20;currentY=rec.lineTo.y/20;currentPath.push({x:currentX,y:currentY});}
                    break;
                case 'curvedEdge':
                    if(rec.curveTo){
                        const cx=rec.curveTo.controlX/20, cy=rec.curveTo.controlY/20, ax=rec.curveTo.anchorX/20, ay=rec.curveTo.anchorY/20;
                        const dx1=cx-x, dy1=cy-y, dx2=ax-cx, dy2=ay-cy; const len=Math.sqrt(dx1*dx1+dy1*dy1)+Math.sqrt(dx2*dx2+dy2*dy2);
                        const seg=Math.max(4,Math.min(20,Math.ceil(len/10)));
                        for(let i=1;i<=seg;i++){const t=i/seg;const px=(1-t)*(1-t)*x+2*(1-t)*t*cx+t*t*ax;const py=(1-t)*(1-t)*y+2*(1-t)*t*cy+t*t*ay;currentPath.push({x:px,y:py});}
                        x=ax;y=ay;
                    }
                    break;
            }
        }
        pushPath(); // Push any remaining path
        return paths;
    }

    private earClippingTriangulation(points:{x:number,y:number}[]) {
        if (points.length<3) return [] as {x:number,y:number}[][];
        const pts=this.removeDuplicatePoints(points); if(pts.length<3) return [];
        const verts=[...pts]; 
        
        // The winding order of vertices is crucial for triangulation.
        // We ensure it's counter-clockwise, which is what this algorithm expects.
        if(this.isClockwise(verts)) {
            verts.reverse();
        }

        const tris:{x:number,y:number}[][]=[];
        let guard=0;
        while(verts.length > 3 && guard < 2000){ // Increased guard
            guard++;
            let cut=false;
            for(let i=0;i<verts.length;i++){
                const prev=verts[(i-1+verts.length)%verts.length];
                const curr=verts[i];
                const next=verts[(i+1)%verts.length];
                if(this.isEar(prev,curr,next,verts)) { tris.push([prev,curr,next]); verts.splice(i,1); cut=true; break; }
            }
            if(!cut){ 
                // If no ear can be found, the polygon is likely complex or self-intersecting.
                // As a fallback, we create a simple fan triangulation from the first vertex.
                // This is not perfect but prevents the renderer from crashing.
                console.warn('Ear clipping failed, using triangle fan fallback.');
                const c=verts[0]; 
                for(let i=1; i<verts.length-1; i++) {
                    tris.push([c, verts[i], verts[i+1]]);
                }
                break; 
            }
        }
        if(verts.length===3) tris.push([verts[0],verts[1],verts[2]]);
        return tris;
    }

    private removeDuplicatePoints(points:{x:number,y:number}[]) { 
        const out:typeof points=[]; 
        const eps=0.001; 
        for(const p of points) { 
            if(!out.some(o=>Math.abs(o.x-p.x)<eps && Math.abs(o.y-p.y)<eps)) {
                out.push(p);
            }
        } 
        return out; 
    }
    private isClockwise(points:{x:number,y:number}[]){ let s=0; for(let i=0;i<points.length;i++){const c=points[i], n=points[(i+1)%points.length]; s+=(n.x-c.x)*(n.y+c.y);} return s>0; }
    private isEar(p:{x:number,y:number},c:{x:number,y:number},n:{x:number,y:number},verts:{x:number,y:number}[]){ const cross=(n.x-c.x)*(p.y-c.y)-(n.y-c.y)*(p.x-c.x); if(cross<=0) return false; for(const v of verts){ if(v===p||v===c||v===n) continue; if(this.pointInTriangle(v,p,c,n)) return false;} return true; }
    private pointInTriangle(p:{x:number,y:number},a:{x:number,y:number},b:{x:number,y:number},c:{x:number,y:number}){ const s=(p1:{x:number,y:number},p2:{x:number,y:number},p3:{x:number,y:number})=> (p1.x-p3.x)*(p2.y-p3.y)-(p2.x-p3.x)*(p1.y-p3.y); const d1=s(p,a,b), d2=s(p,b,c), d3=s(p,c,a); const hasNeg=(d1<0)||(d2<0)||(d3<0); const hasPos=(d1>0)||(d2>0)||(d3>0); return !(hasNeg&&hasPos); }
    private triangleArea(a:{x:number,y:number},b:{x:number,y:number},c:{x:number,y:number}){ return Math.abs((a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y))/2); }

    private calculateBounds(points:{x:number,y:number}[]){ if(!points.length) return {xMin:0,xMax:0,yMin:0,yMax:0}; let xMin=points[0].x,xMax=points[0].x,yMin=points[0].y,yMax=points[0].y; for(const p of points){ if(p.x<xMin)xMin=p.x; if(p.x>xMax)xMax=p.x; if(p.y<yMin)yMin=p.y; if(p.y>yMax)yMax=p.y;} return {xMin,xMax,yMin,yMax}; }
    private getFillType(fs:FillStyle){ switch(fs?.type){ case 0x00:return 'solid'; case 0x10:case 0x12:case 0x13:return 'gradient'; case 0x40:case 0x41:case 0x42:case 0x43:return 'bitmap'; default:return 'solid'; } }
    // Returns the fill color for a given fill style. If not found, returns magenta for debugging.
    private getFillColor(fs:FillStyle): Color { 
        if(fs?.color) return fs.color; 
        if(fs?.gradient?.gradientRecords?.length) return fs.gradient.gradientRecords[0].color; 
        // Return a default magenta color for debugging if no valid fill is found.
        return {r:1, g:0, b:1, a:1}; 
    }

    // ---------------- Bitmap Texture Loader ----------------
    // Loads a bitmap texture into WebGL and caches it by bitmapId.
    // Call this when you have a new bitmap to use in a shape.
    loadBitmapTexture(bitmapId:number, image: ImageData | HTMLImageElement | HTMLCanvasElement){
        const tex = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_S,this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_T,this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_MIN_FILTER,this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_MAG_FILTER,this.gl.LINEAR);
        this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,image as any);
        this.textures.set(bitmapId, tex);
        return tex;
    }

    // ---------------- Cleanup ----------------
    // Call this method to free all WebGL resources when the renderer is no longer needed.
    destroy(){
        for (const buf of [this.vertexBuffer,this.colorBuffer,this.uvBuffer]) if(buf) this.gl.deleteBuffer(buf);
        for (const prog of [this.shaderProgram,this.gradientShaderProgram,this.bitmapShaderProgram]) if(prog) this.gl.deleteProgram(prog);
        for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
        this.textures.clear();
    }

    // Creates an orthographic projection matrix for 2D rendering.
    private createOrthographicMatrix(left:number,right:number,bottom:number,top:number,near:number,far:number){
        const m=new Float32Array(16);
        m[0]=2/(right-left); m[1]=0; m[2]=0; m[3]=0;
        m[4]=0; m[5]=2/(top-bottom); m[6]=0; m[7]=0;
        m[8]=0; m[9]=0; m[10]=-2/(far-near); m[11]=0;
        m[12]=-(right+left)/(right-left); m[13]=-(top+bottom)/(top-bottom); m[14]=-(far+near)/(far-near); m[15]=1;
        return m;
    }

    // Creates a model-view matrix from a SWF Matrix transform (if provided).
    private createModelViewMatrix(transform?: Matrix){
        const m=new Float32Array(16);
        // Initialize to identity matrix
        m[0]=1; m[1]=0; m[2]=0; m[3]=0;
        m[4]=0; m[5]=1; m[6]=0; m[7]=0;
        m[8]=0; m[9]=0; m[10]=1; m[11]=0;
        m[12]=0; m[13]=0; m[14]=0; m[15]=1;
        if(transform){
            m[0]=transform.scaleX; 
            m[1]=transform.rotateSkew0;
            m[4]=transform.rotateSkew1; 
            m[5]=transform.scaleY;
            // SWF coordinates are in 'twips' (1/20th of a pixel). Convert to pixels.
            m[12]=transform.translateX/20; 
            m[13]=transform.translateY/20;
        }
        return m;
    }
}
