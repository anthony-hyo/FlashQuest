import { loadSwf, SWFHeader } from './swf/loader';
import { parseSwf, SwfHeader, SwfTag } from './swf/parser';
import { WebGLRenderer } from './gl/renderer';
import { SwfTagCode } from './swf/tags';
import { Bytes } from "./utils/bytes";

export type FillStyle = {
    type: number;
    color?: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
};

export type LineStyle = {
    width: number;
    color: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
};

export type ShapeRecord =
    | { type: 'moveTo'; x: number; y: number }
    | { type: 'lineTo'; x: number; y: number; fillStyle0?: number; fillStyle1?: number; lineStyle?: number }
    | { type: 'curveTo'; controlX: number; controlY: number; x: number; y: number; fillStyle0?: number; fillStyle1?: number; lineStyle?: number };

export type DisplayObject = {
    bounds?: { xMin: number; yMin: number; xMax: number; yMax: number };
    fillStyles?: FillStyle[];
    lineStyles?: LineStyle[];
    records?: ShapeRecord[];
    color?: { r: number; g: number; b: number; a: number };
    x?: number;
    y?: number;
    width?: number;
    height?: number;
};

export type PlacedObject = {
    characterId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: DisplayObject;
    matrix?: {
        scaleX: number;
        scaleY: number;
        rotateSkew0: number;
        rotateSkew1: number;
        translateX: number;
        translateY: number;
    };
    color?: { r: number; g: number; b: number; a: number };
};

const TWIPS = 20;

export class FlashQuest {

    private canvas: HTMLCanvasElement;
    private renderer: WebGLRenderer;
    private header: SwfHeader | null = null;
    private tags: SwfTag[] = [];
    private fileHeader!: SWFHeader;
    private displayList: DisplayObject[] = [];
    private currentFrame: number = 0;
    private tagPointer: number = 0;
    private lastTime: number = 0;
    private timeAccumulator: number = 0;
    private isPlaying = false;
    private backgroundColor = { r: 0, g: 0, b: 0, a: 1 };
    private shapes: Record<number, DisplayObject> = {};
    private placedObjects: Record<number, PlacedObject> = {};
    private nextDepth = 1;
    private animationId: number | null = null;

    private overlayCanvas!: HTMLCanvasElement;
    private overlayCtx!: CanvasRenderingContext2D | null;
    private debugMode = true;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new WebGLRenderer(canvas);

        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.left = this.canvas.offsetLeft + 'px';
        this.overlayCanvas.style.top = this.canvas.offsetTop + 'px';
        this.overlayCanvas.style.pointerEvents = 'none';
        this.overlayCanvas.id = 'overlay-canvas';
        (this.canvas.parentElement || document.body).appendChild(this.overlayCanvas);
        this.overlayCtx = this.overlayCanvas.getContext('2d');
    }

    showStatus(message: string | null, type: string) {
        const status = document.getElementById('status')!;
        status.textContent = message;
        status.className = `status ${type}`;
        status.classList.remove('hidden');

        if (type === 'success') {
            setTimeout(() => {
                status.classList.add('hidden');
            }, 3000);
        }
    }

    async load(source: string | File) {
        try {
            this.showStatus('Carregando SWF...', 'loading');
            console.log('Iniciando carregamento do SWF:', source);

            const { header: fileHeader, dataView } = await loadSwf(source);
            console.log('SWF carregado. Header:', fileHeader, 'DataView size:', dataView.byteLength);

            const { header, tags } = parseSwf(dataView);
            console.log('SWF parseado. Header:', header, 'Tags:', tags.length);

            this.header = header;
            this.tags = tags;
            this.fileHeader = fileHeader;
            
            const width = Math.abs(header.frameSize.xMax - header.frameSize.xMin) / TWIPS;
            const height = Math.abs(header.frameSize.yMax - header.frameSize.yMin) / TWIPS;

            console.log('Dimensões calculadas:', { width, height, frameSize: header.frameSize });
            
            this.canvas.width = Math.min(width, 1200) || 800;
            this.canvas.height = Math.min(height, 800) || 600;
            
            this.overlayCanvas.width = this.canvas.width;
            this.overlayCanvas.height = this.canvas.height;
            
            this.overlayCanvas.style.width = this.canvas.style.width;
            this.overlayCanvas.style.height = this.canvas.style.height;
            this.renderer.setupGL();

            this.updateInfoPanel();

            this.preProcessTags();

            this.reset();
            this.processFrame();

            this.showStatus(`SWF carregado com sucesso! ${tags.length} tags, ${Object.keys(this.shapes).length} shapes definidas.`, 'success');
            
            document.getElementById('info-panel')!.classList.remove('hidden');

            setTimeout(() => this.play(), 1000);

        } catch (error: any) {
            console.error('Erro ao carregar SWF:', error);
            
            this.showStatus(`Erro: ${error.message}`, 'error');
        }
    }

    preProcessTags() {
        // First pass: process all DefineShape tags to create the shape library
        this.tags.forEach((tag, index) => {
            try {
                // Only process actual DefineShape tags (codes 2, 22, 32, 83)
                if (
                    tag.code === SwfTagCode.DefineShape ||
                    tag.code === SwfTagCode.DefineShape2 ||
                    tag.code === SwfTagCode.DefineShape3 ||
                    tag.code === SwfTagCode.DefineShape4
                ) {
                    console.log(`Pré-processando DefineShape tag ${index}, code: ${tag.code}`);
                    // Reset data position before processing
                    tag.data.position = 0;
                    tag.data.bitPosition = 0;
                    this.processDefineShape(tag);
                }
            } catch (e) {
                console.warn(`Erro no pré-processamento da tag ${index}:`, e);
            }
        });

        console.log('Pré-processamento concluído. Shapes definidas:', Object.keys(this.shapes).length);
    }

    updateInfoPanel() {
        if (!this.header || !this.fileHeader) return;

        const width = Math.abs(this.header.frameSize.xMax - this.header.frameSize.xMin) / 20;
        const height = Math.abs(this.header.frameSize.yMax - this.header.frameSize.yMin) / 20;

        document.getElementById('swf-version')!.textContent = String(this.fileHeader.version);
        document.getElementById('swf-dimensions')!.textContent = `${width.toFixed(0)} × ${height.toFixed(0)}`;
        document.getElementById('swf-framerate')!.textContent = `${this.header.frameRate.toFixed(1)} fps`;
        document.getElementById('swf-frames')!.textContent = String(this.header.frameCount);
        document.getElementById('total-tags')!.textContent = String(this.tags.length);
    }

    play() {
        if (!this.header) return;
        this.isPlaying = true;
        this.lastTime = performance.now();
        this.animate();
    }

    pause() {
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    stop() {
        this.pause();
        this.reset();
        this.processFrame();
    }

    restart() {
        this.reset();
        this.play();
    }

    reset() {
        this.currentFrame = 0;
        this.tagPointer = 0;
        this.timeAccumulator = 0;
        this.displayList = [];
        this.placedObjects = {};
        this.nextDepth = 1;
        this.backgroundColor = { r: 0, g: 0, b: 0, a: 1 };
    }

    animate() {
        if (!this.isPlaying) return;

        this.animationId = requestAnimationFrame(() => this.animate());

        if (!this.header) return;

        const currentTime = performance.now();
        const delta = currentTime - this.lastTime;
        this.lastTime = currentTime;
        this.timeAccumulator += delta;

        const frameDuration = 1000 / this.header.frameRate;
        let processed = false;

        while (this.timeAccumulator >= frameDuration) {
            this.processFrame();
            this.timeAccumulator -= frameDuration;
            processed = true;
        }

        if (processed) {
            this.render();
        }
    }

    processFrame() {
        if (!this.tags || !this.header) return;

        let frameProcessed = false;
        let safetyCounter = 0; // Prevent infinite loops

        while (this.tagPointer < this.tags.length && !frameProcessed && safetyCounter < 200) {
            safetyCounter++;
            const tag: SwfTag = this.tags[this.tagPointer++];

            try {
                // Reset tag data position
                tag.data.position = 0;
                tag.data.bitPosition = 0;

                switch (tag.code) {
                    case SwfTagCode.SetBackgroundColor:
                        if (tag.data.position + 3 <= tag.data.dataView.byteLength) {
                            const r = tag.data.readUint8() / 255;
                            const g = tag.data.readUint8() / 255;
                            const b = tag.data.readUint8() / 255;
                            this.backgroundColor = { r, g, b, a: 1 };
                        }
                        break;

                    case SwfTagCode.DefineShape:
                    case SwfTagCode.DefineShape2:
                    case SwfTagCode.DefineShape3:
                        this.processDefineShapeSafe(tag);
                        break;

                    case SwfTagCode.PlaceObject:
                    case SwfTagCode.PlaceObject2:
                    case SwfTagCode.PlaceObject3:
                        this.processPlaceObjectSafe(tag);
                        break;

                    case SwfTagCode.RemoveObject:
                    case SwfTagCode.RemoveObject2:
                        this.processRemoveObjectSafe(tag);
                        break;

                    case SwfTagCode.ShowFrame:
                        this.currentFrame++;
                        frameProcessed = true;

                        if (this.currentFrame >= this.header.frameCount) {
                            this.currentFrame = 0;
                            this.tagPointer = 0;
                        }
                        break;

                    case SwfTagCode.End:
                        this.currentFrame = 0;
                        this.tagPointer = 0;
                        frameProcessed = true;
                        break;

                    default:
                        // Skip unknown tags safely
                        //console.log(`Skipping tag code: ${tag.code}`);
                        break;
                }
            } catch (e) {
                console.warn(`Erro processando tag ${tag.code}:`, e);
            }
        }

        if (safetyCounter >= 200) {
            console.warn('Safety counter atingido, resetando frame');
            this.currentFrame = 0;
            this.tagPointer = 0;
        }

        // @ts-ignore
        document.getElementById('current-frame').textContent = (this.currentFrame + 1).toString();
    }
    
    processDefineShapeSafe(tag: SwfTag) {
        const data = tag.data;
        try {
            if (data.position + 4 <= data.dataView.byteLength) {
                const shapeId = data.readUint16();
                const bounds = {
                    xmin: data.readUint16(),
                    xmax: data.readUint16(),
                };
                console.log(`DefineShape seguro: id=${shapeId}`, bounds);
            }
        } catch (e) {
            console.warn('Erro no DefineShapeSafe:', e);
        }
    }

    processPlaceObjectSafe(tag: SwfTag) {
        try {
            if (!tag.data || tag.data.position >= tag.data.dataView.byteLength) return;

            let characterId, depth;

            if (tag.code === SwfTagCode.PlaceObject) {
                if (tag.data.position + 4 <= tag.data.dataView.byteLength) {
                    characterId = tag.data.readUint16();
                    depth = tag.data.readUint16();
                } else return; // não há bytes suficientes
            } else if (tag.code === SwfTagCode.PlaceObject2 || tag.code === SwfTagCode.PlaceObject3) {
                if (tag.data.position + 3 <= tag.data.dataView.byteLength) {
                    const flags = tag.data.readUint8();
                    depth = tag.data.readUint16();

                    if ((flags & 0x02) && tag.data.position + 2 <= tag.data.dataView.byteLength) {
                        characterId = tag.data.readUint16();
                    }
                } else return; // não há bytes suficientes
            }

            if (characterId && this.shapes[characterId] && depth !== undefined) {
                const shape: DisplayObject = this.shapes[characterId];
                
                if (shape.bounds) {
                    const shapeWidth = Math.abs(shape.bounds.xMax - shape.bounds.xMin) / TWIPS || 50;
                    const shapeHeight = Math.abs(shape.bounds.yMax - shape.bounds.yMin) / TWIPS || 50;

                    // Create display object with proper shape data
                    this.placedObjects[depth] = {
                        characterId,
                        x: (shape.bounds.xMin / TWIPS) || 0,
                        y: (shape.bounds.yMin / TWIPS) || 0,
                        width: shapeWidth,
                        height: shapeHeight,
                        shape
                    };

                    console.log(`Placed object ${characterId} at depth ${depth}`);
                }
            }
        } catch (e) {
            console.warn('Erro ao processar PlaceObject:', e);
        }
    }


    processRemoveObjectSafe(tag: SwfTag) {
        try {
            let depth;
            if (tag.code === SwfTagCode.RemoveObject) {
                if (tag.data.dataView.byteLength >= 4) {
                    tag.data.readUint16(); // characterId
                    depth = tag.data.readUint16();
                }
            } else {
                if (tag.data.dataView.byteLength >= 2) {
                    depth = tag.data.readUint16();
                }
            }

            if (depth !== undefined) {
                delete this.placedObjects[depth];
                console.log(`Removed object at depth ${depth}`);
            }
        } catch (e) {
            console.warn('Erro ao processar RemoveObject:', e);
        }
    }

    processDefineShape(tag: SwfTag) {
        const shapeId = tag.data.readUint16();
        const bounds = tag.data.readRect();
        const fillStyles = this.parseFillStylesSafe(tag.data, tag.code);
        const lineStyles = this.parseLineStylesSafe(tag.data, tag.code);
        const records = this.parseShapeRecordsSafe(tag.data);

        this.shapes[shapeId] = { bounds, fillStyles, lineStyles, records };
    }

    parseFillStylesSafe(data: Bytes, shapeVersion: number): FillStyle[] {
        const fillStyles: FillStyle[] = [];
        try {
            if (data.position >= data.dataView.byteLength) return fillStyles;
            
            const fillStyleCount = data.readUint8();
            let actualCount = fillStyleCount;

            if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
                if (data.position + 1 >= data.dataView.byteLength) return fillStyles;
                actualCount = data.readUint16();
            }

            for (let i = 0; i < actualCount && data.position < data.dataView.byteLength; i++) {
                const fillType = data.readUint8();
                let fill: any = { type: fillType };

                if (fillType === 0x00) { // Solid fill
                    if (data.position + 2 < data.dataView.byteLength) {
                        if (shapeVersion >= SwfTagCode.DefineShape3) {
                            if (data.position + 3 < data.dataView.byteLength) {
                                fill.color = {
                                    r: data.readUint8() / 255,
                                    g: data.readUint8() / 255,
                                    b: data.readUint8() / 255,
                                    a: data.readUint8() / 255
                                };
                            } else break;
                        } else {
                            fill.color = {
                                r: data.readUint8() / 255,
                                g: data.readUint8() / 255,
                                b: data.readUint8() / 255,
                                a: 1
                            };
                        }
                    } else {
                        fill.color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
                    }
                } else {
                    // For gradients and bitmaps, create a fallback solid color
                    fill.color = {
                        r: Math.random() * 0.8 + 0.2,
                        g: Math.random() * 0.8 + 0.2,
                        b: Math.random() * 0.8 + 0.2,
                        a: 1
                    };

                    // Skip gradient/bitmap data safely
                    const skipAmount = Math.min(20, data.dataView.byteLength - data.position);
                    if (skipAmount > 0) data.skip(skipAmount);
                }

                fillStyles.push(fill);
            }
        } catch (e) {
            console.warn('Error in parseFillStylesSafe:', e);
        }
        return fillStyles;
    }

    parseLineStylesSafe(data: Bytes, shapeVersion: number): LineStyle[] {
        const lineStyles: LineStyle[] = [];
        try {
            if (data.position >= data.dataView.byteLength) return lineStyles;

            const lineStyleCount = data.readUint8();
            let actualCount = lineStyleCount;

            if (lineStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
                if (data.position + 1 >= data.dataView.byteLength) return lineStyles;
                actualCount = data.readUint16();
            }

            for (let i = 0; i < actualCount && data.position + 5 < data.dataView.byteLength; i++) {
                const width = data.readUint16();
                let color;

                if (shapeVersion >= SwfTagCode.DefineShape3) {
                    if (data.position + 3 < data.dataView.byteLength) {
                        color = {
                            r: data.readUint8() / 255,
                            g: data.readUint8() / 255,
                            b: data.readUint8() / 255,
                            a: data.readUint8() / 255
                        };
                    } else break;
                } else {
                    if (data.position + 2 < data.dataView.byteLength) {
                        color = {
                            r: data.readUint8() / 255,
                            g: data.readUint8() / 255,
                            b: data.readUint8() / 255,
                            a: 1
                        };
                    } else break;
                }

                lineStyles.push({ width, color });
            }
        } catch (e) {
            console.warn('Error in parseLineStylesSafe:', e);
        }

        return lineStyles;
    }

    parseShapeRecordsSafe(data: Bytes): (ShapeRecord)[] {
        const records: ShapeRecord[] = [];
        try {
            if (data.position >= data.dataView.byteLength) return records;

            // Skip shape records parsing for now to avoid complex bit reading errors
            // This is a simplified version that just creates basic records
            records.push({
                type: 'moveTo',
                x: 0,
                y: 0
            });

        } catch (e) {
            console.warn('Error in parseShapeRecordsSafe:', e);
        }

        return records;
    }

    parseFillStyles(data: Bytes, shapeVersion: number): FillStyle[] {
        const fillStyles: FillStyle[] = [];
        const fillStyleCount = data.readUint8();
        let actualCount = fillStyleCount;

        if (fillStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
            actualCount = data.readUint16();
        }

        for (let i = 0; i < actualCount; i++) {
            const fillType = data.readUint8();
            let fill: any = { type: fillType };

            if (fillType === 0x00) { // Solid fill
                if (shapeVersion >= SwfTagCode.DefineShape3) {
                    fill.color = {
                        r: data.readUint8() / 255,
                        g: data.readUint8() / 255,
                        b: data.readUint8() / 255,
                        a: data.readUint8() / 255
                    };
                } else {
                    fill.color = {
                        r: data.readUint8() / 255,
                        g: data.readUint8() / 255,
                        b: data.readUint8() / 255,
                        a: 1
                    };
                }
            } else {
                // For gradients and bitmaps, create a fallback solid color
                fill.color = {
                    r: Math.random() * 0.8 + 0.2,
                    g: Math.random() * 0.8 + 0.2,
                    b: Math.random() * 0.8 + 0.2,
                    a: 1
                };

                // Skip gradient/bitmap data (simplified)
                try {
                    data.skip(Math.min(50, data.dataView.byteLength - data.position));
                } catch (e) {
                    console.warn('Error skipping fill style data:', e);
                }
            }

            fillStyles.push(fill);
        }

        return fillStyles;
    }

    parseLineStyles(data: Bytes, shapeVersion: number) {
        const lineStyles = [];
        try {
            const lineStyleCount = data.readUint8();
            let actualCount = lineStyleCount;

            if (lineStyleCount === 0xFF && shapeVersion >= SwfTagCode.DefineShape2) {
                actualCount = data.readUint16();
            }

            for (let i = 0; i < actualCount; i++) {
                const width = data.readUint16();
                let color;

                if (shapeVersion >= SwfTagCode.DefineShape3) {
                    color = {
                        r: data.readUint8() / 255,
                        g: data.readUint8() / 255,
                        b: data.readUint8() / 255,
                        a: data.readUint8() / 255
                    };
                } else {
                    color = {
                        r: data.readUint8() / 255,
                        g: data.readUint8() / 255,
                        b: data.readUint8() / 255,
                        a: 1
                    };
                }

                lineStyles.push({ width, color });
            }
        } catch (e) {
            console.warn('Error parsing line styles:', e);
        }

        return lineStyles;
    }

    parseShapeRecords(data: Bytes) {
        const records = [];
        let currentX = 0;
        let currentY = 0;
        let fillStyle0 = 0;
        let fillStyle1 = 0;
        let lineStyle = 0;

        try {
            const numFillBits = data.readUint8() >> 4;
            const numLineBits = data.readUint8() & 0x0F;

            data.position--; // Go back to read properly
            data.align();

            while (!data.eof) {
                const typeFlag = data.readBit();

                if (typeFlag === 0) { // Style change record
                    const stateNewStyles = data.readBit();
                    const stateLineStyle = data.readBit();
                    const stateFillStyle1 = data.readBit();
                    const stateFillStyle0 = data.readBit();
                    const stateMoveTo = data.readBit();

                    if (stateMoveTo) {
                        const moveBits = data.readUint8() >> 3;
                        data.position--; data.bitPosition = 5;
                        currentX = data.readSignedBits(moveBits);
                        currentY = data.readSignedBits(moveBits);

                        records.push({
                            type: 'moveTo',
                            x: currentX,
                            y: currentY
                        });
                    }

                    if (stateFillStyle0) {
                        fillStyle0 = data.readUint8(); // Simplified
                    }
                    if (stateFillStyle1) {
                        fillStyle1 = data.readUint8(); // Simplified
                    }
                    if (stateLineStyle) {
                        lineStyle = data.readUint8(); // Simplified
                    }

                    if (stateNewStyles) {
                        // Skip new styles for now
                        break;
                    }

                    // End of shape records
                    const nextBits = data.readBit();
                    if (nextBits === 0) break;

                } else { // Edge record
                    const straightFlag = data.readBit();

                    if (straightFlag) { // Straight edge
                        const numBits = (data.readUint8() >> 2) + 2;
                        data.position--; data.bitPosition = 2;

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
                            type: 'lineTo',
                            x: currentX,
                            y: currentY,
                            fillStyle0,
                            fillStyle1,
                            lineStyle
                        });
                    } else {
                        // Curved edge - simplified as line
                        const numBits = (data.readUint8() >> 4) + 2;
                        data.position--; data.bitPosition = 4;

                        const controlDeltaX = data.readSignedBits(numBits);
                        const controlDeltaY = data.readSignedBits(numBits);
                        const anchorDeltaX = data.readSignedBits(numBits);
                        const anchorDeltaY = data.readSignedBits(numBits);

                        currentX += controlDeltaX + anchorDeltaX;
                        currentY += controlDeltaY + anchorDeltaY;

                        records.push({
                            type: 'curveTo',
                            controlX: currentX - anchorDeltaX + controlDeltaX,
                            controlY: currentY - anchorDeltaY + controlDeltaY,
                            x: currentX,
                            y: currentY,
                            fillStyle0,
                            fillStyle1,
                            lineStyle
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Error parsing shape records:', e);
        }

        return records;
    }

    processPlaceObject(tag: SwfTag) {
        try {
            let characterId, depth, matrix, colorTransform, hasMatrix = false;

            if (tag.code === SwfTagCode.PlaceObject) {
                characterId = tag.data.readUint16();
                depth = tag.data.readUint16();
                // Read matrix if present
                if (!tag.data.eof) {
                    matrix = this.readMatrix(tag.data);
                    hasMatrix = true;
                }
            } else {
                const flags = tag.data.readUint8();
                depth = tag.data.readUint16();

                if (flags & 0x02) characterId = tag.data.readUint16();
                if (flags & 0x04) {
                    matrix = this.readMatrix(tag.data);
                    hasMatrix = true;
                }
                if (flags & 0x08) {
                    // Skip color transform for now
                    tag.data.skip(8);
                }
                // Skip other flags
            }

            if (characterId && this.shapes[characterId]) {
                const shape = this.shapes[characterId];
                if (shape.bounds) {
                    const TWIPS = 20;

                    // Use matrix transform if available
                    let x = 0, y = 0;
                    let scaleX = 1, scaleY = 1;

                    if (hasMatrix && matrix) {
                        x = matrix.translateX / TWIPS;
                        y = matrix.translateY / TWIPS;
                        scaleX = matrix.scaleX || 1;
                        scaleY = matrix.scaleY || 1;
                    }

                    // Calculate actual shape dimensions
                    const shapeWidth = Math.abs(shape.bounds.xMax - shape.bounds.xMin) / TWIPS;
                    const shapeHeight = Math.abs(shape.bounds.yMax - shape.bounds.yMin) / TWIPS;

                    // Create display object with proper shape data
                    this.placedObjects[depth] = {
                        characterId,
                        x: x + (shape.bounds.xMin / TWIPS),
                        y: y + (shape.bounds.yMin / TWIPS),
                        width: shapeWidth * scaleX,
                        height: shapeHeight * scaleY,
                        shape: shape,
                        matrix: matrix
                    };

                    console.log(`Placed object ${characterId} at depth ${depth}:`, this.placedObjects[depth]);
                }
            }
        } catch (e) {
            console.warn('Erro ao processar PlaceObject:', e);
        }
    }

    readMatrix(data: Bytes) {
        try {
            data.align();

            const hasScale = data.readBit();
            let scaleX = 1, scaleY = 1;

            if (hasScale) {
                const nScaleBits = data.readUint8() >> 3;
                data.position--; data.bitPosition = 5;
                scaleX = data.readSignedBits(nScaleBits) / 65536;
                scaleY = data.readSignedBits(nScaleBits) / 65536;
            }

            const hasRotate = data.readBit();
            let rotateSkew0 = 0, rotateSkew1 = 0;

            if (hasRotate) {
                const nRotateBits = data.readUint8() >> 3;
                data.position--; data.bitPosition = 5;
                rotateSkew0 = data.readSignedBits(nRotateBits) / 65536;
                rotateSkew1 = data.readSignedBits(nRotateBits) / 65536;
            }

            const nTranslateBits = data.readUint8() >> 3;
            data.position--; data.bitPosition = 5;
            const translateX = data.readSignedBits(nTranslateBits);
            const translateY = data.readSignedBits(nTranslateBits);

            data.align();

            return {
                scaleX,
                scaleY,
                rotateSkew0,
                rotateSkew1,
                translateX,
                translateY
            };
        } catch (e) {
            console.warn('Error reading matrix:', e);
            return {
                scaleX: 1,
                scaleY: 1,
                rotateSkew0: 0,
                rotateSkew1: 0,
                translateX: 0,
                translateY: 0
            };
        }
    }

    processRemoveObject(tag: SwfTag) {
        try {
            let depth;
            if (tag.code === SwfTagCode.RemoveObject) {
                tag.data.readUint16(); // characterId
                depth = tag.data.readUint16();
            } else {
                depth = tag.data.readUint16();
            }
            delete this.placedObjects[depth];
        } catch (e) {
            console.warn('Erro ao processar RemoveObject:', e);
        }
    }

    render() {
        this.displayList = [{
            x: 0,
            y: 0,
            width: this.canvas.width,
            height: this.canvas.height,
            color: this.backgroundColor
        }];

        Object.values(this.placedObjects).forEach(obj => {
            this.renderShape(obj);
        });

        this.renderer.draw(this.displayList);

        // DEBUG overlay: desenha bounds e ids
        if (this.debugMode && this.overlayCtx) {
            const ctx = this.overlayCtx;
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
            ctx.save();
            ctx.lineWidth = 2;
            let i = 0;
            Object.entries(this.placedObjects).forEach(([depth, obj]) => {
                const color = `hsl(${(i * 53) % 360} 80% 60%)`;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                const x = Math.round(obj.x);
                const y = Math.round(obj.y);
                const w = Math.max(1, Math.round(obj.width));
                const h = Math.max(1, Math.round(obj.height));
                ctx.strokeRect(x, y, w, h);
                ctx.font = '12px sans-serif';
                ctx.fillText(`id:${obj.characterId} d:${depth}`, x + 4, y + 12);
                i++;
            });
            ctx.restore();

            // também loga um resumo compacto
            console.log('placedObjects keys:', Object.keys(this.placedObjects));
        }
    }

    renderShape(placedObject: PlacedObject) {
        const shape = placedObject.shape;
        if (!shape) return;

        const TWIPS = 20;

        // Render fills
        if (shape.fillStyles && shape.records) {
            let currentX = placedObject.x;
            let currentY = placedObject.y;

            shape.records.forEach(record => {
                if (record.type === 'moveTo') {
                    currentX = placedObject.x + record.x / TWIPS;
                    currentY = placedObject.y + record.y / TWIPS;
                } else if (record.type === 'lineTo' || record.type === 'curveTo') {
                    const endX = placedObject.x + record.x / TWIPS;
                    const endY = placedObject.y + record.y / TWIPS;

                    // @ts-ignore
                    const fillColor = shape.fillStyles[record.fillStyle0 || 0]?.color;
                    if (fillColor) {
                        const width = Math.abs(endX - currentX) || 2;
                        const height = Math.abs(endY - currentY) || 2;
                        this.displayList.push({
                            x: Math.min(currentX, endX),
                            y: Math.min(currentY, endY),
                            width,
                            height,
                            color: fillColor
                        });
                    }

                    currentX = endX;
                    currentY = endY;
                }
            });
        } else {
            // fallback para shapes sem records
            this.displayList.push({
                x: placedObject.x,
                y: placedObject.y,
                width: placedObject.width || 50,
                height: placedObject.height || 50,
                color: { r: 0.8, g: 0.2, b: 0.2, a: 1 }
            });
        }
    }

    renderShapeRecords(records: ShapeRecord[], placedObject: PlacedObject) {
        const TWIPS = 20;
        let currentX = placedObject.x;
        let currentY = placedObject.y;

        records.forEach(record => {
            if (record.type === 'moveTo') {
                currentX = placedObject.x + (record.x / TWIPS);
                currentY = placedObject.y + (record.y / TWIPS);
            } else if (record.type === 'lineTo') {
                const endX = placedObject.x + (record.x / TWIPS);
                const endY = placedObject.y + (record.y / TWIPS);

                // Draw line as small rectangle
                const lineWidth = 2;
                const lineLength = Math.sqrt(Math.pow(endX - currentX, 2) + Math.pow(endY - currentY, 2));

                if (lineLength > 0) {
                    this.displayList.push({
                        x: currentX,
                        y: currentY - lineWidth/2,
                        width: lineLength,
                        height: lineWidth,
                        color: { r: 0.2, g: 0.8, b: 0.3, a: 1 }
                    });
                }

                currentX = endX;
                currentY = endY;
            }
        });
    }



}

(window as any).FlashQuest = FlashQuest;