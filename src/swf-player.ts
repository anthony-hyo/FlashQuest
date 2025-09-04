import { loadSwf } from './swf/loader';
import { parseSwf } from './swf/parser';
import { WebGLRenderer } from './gl/renderer';
import { DisplayList, Timeline, Frame } from './swf/display';
import { SwfTagCode } from "./tags/tags";
import { TagHandlerRegistry } from './tags/tag-handler';
import { ShapeTagHandler } from './tags/handlers/shape-handler';
import { ButtonHandler } from './tags/handlers/button-handler';
import { SoundHandler } from './tags/handlers/sound-handler';
import { SpriteHandler } from './tags/handlers/sprite-handler';
import { FilterHandler } from './tags/handlers/filter-handler';
import { MorphShapeHandler } from './tags/handlers/morph-shape-handler';
import { ActionScriptHandler } from './tags/handlers/action-script-handler';
import { TagData } from './tags/tag-handler';

export class SWFPlayer {
    private canvas: HTMLCanvasElement;
    private renderer: WebGLRenderer;
    private timeline: Timeline = new Timeline();
    private isPlaying: boolean = false;
    private frameRate: number = 12;
    private animationId: number | null = null;
    private lastFrameTime: number = 0;
    private tagHandlers: TagHandlerRegistry = new TagHandlerRegistry();
    private resourceCache: Map<number, any> = new Map();
    private interactiveObjects: Map<number, any> = new Map();
    private soundHandler: SoundHandler;
    private spriteHandler: SpriteHandler;
    private actionScriptHandler: ActionScriptHandler;
    private shapeHandler: ShapeTagHandler;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new WebGLRenderer(canvas);
        this.soundHandler = new SoundHandler();
        this.spriteHandler = new SpriteHandler();
        this.actionScriptHandler = new ActionScriptHandler();
        this.shapeHandler = new ShapeTagHandler();
        this.initTagHandlers();
        this.setupInteractivity();
    }

    private initTagHandlers() {
        this.tagHandlers = new TagHandlerRegistry();
        
        // Register core handlers
        this.tagHandlers.register([
            SwfTagCode.DefineShape,
            SwfTagCode.DefineShape2,
            SwfTagCode.DefineShape3,
            SwfTagCode.DefineShape4
        ], this.shapeHandler);

        // Register button handler
        this.tagHandlers.register([
            SwfTagCode.DefineButton,
            SwfTagCode.DefineButton2
        ], new ButtonHandler());

        // Register sound handler
        this.tagHandlers.register([
            SwfTagCode.DefineSound,
            SwfTagCode.StartSound,
            SwfTagCode.SoundStreamHead,
            SwfTagCode.SoundStreamBlock
        ], this.soundHandler);

        // Register sprite handler
        this.tagHandlers.register([
            SwfTagCode.DefineSprite,
            SwfTagCode.PlaceObject,
            SwfTagCode.PlaceObject2,
            SwfTagCode.PlaceObject3
        ], this.spriteHandler);

        // Register filter handler
        this.tagHandlers.register([
            SwfTagCode.PlaceObject2,
            SwfTagCode.PlaceObject3
        ], new FilterHandler());

        // Register morph shape handler
        this.tagHandlers.register([
            SwfTagCode.DefineMorphShape,
            SwfTagCode.DefineMorphShape2
        ], new MorphShapeHandler());

        // Register ActionScript handler
        this.tagHandlers.register([
            SwfTagCode.DoAction,
            SwfTagCode.DoInitAction
        ], this.actionScriptHandler);
    }

    private setupInteractivity() {
        // Set up event listeners for button interactions
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    }

    private handleMouseDown(event: MouseEvent) {
        const pos = this.getCanvasPosition(event);
        for (const [id, obj] of this.interactiveObjects) {
            if (this.hitTest(pos, obj)) {
                obj.handleMouseDown?.();
            }
        }
    }

    private handleMouseUp(event: MouseEvent) {
        const pos = this.getCanvasPosition(event);
        for (const [id, obj] of this.interactiveObjects) {
            if (this.hitTest(pos, obj)) {
                obj.handleMouseUp?.();
            }
        }
    }

    private handleMouseMove(event: MouseEvent) {
        const pos = this.getCanvasPosition(event);
        for (const [id, obj] of this.interactiveObjects) {
            const isHit = this.hitTest(pos, obj);
            if (isHit && !obj.isOver) {
                obj.handleMouseOver?.();
                obj.isOver = true;
            } else if (!isHit && obj.isOver) {
                obj.handleMouseOut?.();
                obj.isOver = false;
            }
        }
    }

    private getCanvasPosition(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
            y: (event.clientY - rect.top) * (this.canvas.height / rect.height)
        };
    }

    private hitTest(pos: { x: number; y: number }, obj: any): boolean {
        // Implement hit testing using shape bounds and matrices
        const bounds = obj.shape.bounds;
        const matrix = obj.matrix || { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
        
        // Transform point to object space
        const localX = (pos.x - matrix.translateX / 20) / matrix.scaleX;
        const localY = (pos.y - matrix.translateY / 20) / matrix.scaleY;
        
        return localX >= bounds.xMin / 20 && localX <= bounds.xMax / 20 &&
               localY >= bounds.yMin / 20 && localY <= bounds.yMax / 20;
    }

    async loadSWF(source: string | File): Promise<void> {
        try {
            const { dataView } = await loadSwf(source);
            const { header, tags } = parseSwf(dataView);

            this.frameRate = header.frameRate;
            this.setupCanvas(header.frameSize);
            await this.buildTimeline(tags);
            
            if (this.timeline.getTotalFrames() === 0) {
                console.warn('No frames found in SWF, creating test content');
                this.createTestContent();
            }

            this.timeline.gotoFrame(0);
            this.render();

        } catch (error) {
            console.error('Failed to load SWF:', error);
            throw error;
        }
    }

    private setupCanvas(frameSize: { xMin: number; xMax: number; yMin: number; yMax: number }) {
        const width = Math.abs(frameSize.xMax - frameSize.xMin) / 20;
        const height = Math.abs(frameSize.yMax - frameSize.yMin) / 20;
        
        this.canvas.width = Math.min(width, 1200) || 800;
        this.canvas.height = Math.min(height, 800) || 600;
    }

    private async buildTimeline(tags: TagData[]) {
        let currentFrame: Frame = { actions: [] };
        const displayList = new DisplayList();
        const batchSize = 100; // Process tags in batches for better performance
        
        for (let i = 0; i < tags.length; i += batchSize) {
            const batch = tags.slice(i, i + batchSize);
            await Promise.all(batch.map(async tag => {
                try {
                    const handler = this.tagHandlers.getHandler(tag.code);
                    if (handler) {
                        await handler.handle(tag, currentFrame, displayList);
                    } else if (tag.code === SwfTagCode.ShowFrame) {
                        this.timeline.addFrame(currentFrame);
                        currentFrame = { actions: [] };
                    } else if (tag.code === SwfTagCode.End && currentFrame.actions.length > 0) {
                        this.timeline.addFrame(currentFrame);
                    }
                } catch (error) {
                    console.error(`Error processing tag ${tag.code}:`, error);
                }
            }));
        }
    }

    private getTagName(code: number): string {
        const tagNames: { [key: number]: string } = {
            0: 'End',
            1: 'ShowFrame',
            2: 'DefineShape',
            4: 'PlaceObject',
            5: 'RemoveObject',
            9: 'SetBackgroundColor',
            22: 'DefineShape2',
            26: 'PlaceObject2',
            28: 'RemoveObject2',
            32: 'DefineShape3',
            70: 'PlaceObject3',
            83: 'DefineShape4'
        };
        return tagNames[code] || `Unknown(${code})`;
    }

    private createTestContent() {
        console.log('Creating test content - red square');
        
        // Create a simple red square shape that should definitely render
        const testShape = {
            bounds: { xMin: 0, xMax: 2000, yMin: 0, yMax: 2000 }, // 100x100 pixels
            fillStyles: [
                { type: 0x00, color: { r: 1, g: 0, b: 0, a: 1 } } // Red solid fill
            ],
            lineStyles: [],
            records: [
                {
                    type: 'styleChange' as const,
                    moveTo: { x: 0, y: 0 },
                    fillStyle0: 1 // Use first fill style (1-indexed)
                },
                {
                    type: 'straightEdge' as const,
                    lineTo: { x: 2000, y: 0 }
                },
                {
                    type: 'straightEdge' as const,
                    lineTo: { x: 2000, y: 2000 }
                },
                {
                    type: 'straightEdge' as const,
                    lineTo: { x: 0, y: 2000 }
                },
                {
                    type: 'straightEdge' as const,
                    lineTo: { x: 0, y: 0 }
                }
            ]
        };

        // Create a frame with the test shape - position it in the center of the screen
        const frame: Frame = {
            actions: [
                {
                    type: 'defineShape',
                    data: { characterId: 1, shape: testShape }
                },
                {
                    type: 'placeObject',
                    data: {
                        characterId: 1,
                        depth: 1,
                        hasCharacter: true,
                        hasMatrix: true,
                        matrix: {
                            scaleX: 0.5, // Make it smaller
                            scaleY: 0.5,
                            rotateSkew0: 0,
                            rotateSkew1: 0,
                            translateX: 4000, // Center in typical 800px canvas
                            translateY: 4000  // Center in typical 600px canvas
                        }
                    }
                }
            ]
        };

        this.timeline.addFrame(frame);
        console.log('Test content created with shape bounds:', testShape.bounds);
        console.log('Canvas dimensions:', this.canvas.width, 'x', this.canvas.height);
    }

    play() {
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.animate();

        console.log('Reprodução iniciada');
    }

    pause() {
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        console.log('Reprodução pausada');
    }

    stop() {
        this.pause();
        this.timeline.gotoFrame(0);
        this.render();

        console.log('Reprodução parada');
    }

    gotoFrame(frameNumber: number) {
        this.timeline.gotoFrame(frameNumber);
        this.render();
    }

    getCurrentFrame(): number {
        return this.timeline.getCurrentFrame();
    }

    getTotalFrames(): number {
        return this.timeline.getTotalFrames();
    }

    // Test method to verify renderer works without SWF
    testRenderer() {
        // This method is for diagnostics only. It creates a simple test shape and renders it.
        console.log('Testing renderer with simple red square...');
        
        // Clear any existing timeline
        this.timeline = new Timeline();
        
        this.createTestContent();
        this.timeline.gotoFrame(0);
        this.render();
        
        // Also test with direct WebGL rendering
        this.testDirectWebGL();
    }
    
    // Test direct WebGL rendering to isolate issues
    private testDirectWebGL() {
        // This method is for diagnostics only. It clears the WebGL canvas directly.
        console.log('Testing direct WebGL rendering...');
        
        try {
            // Test if WebGL context is working
            const gl = this.renderer['gl'];
            console.log('WebGL context:', gl);
            console.log('Canvas dimensions:', this.canvas.width, 'x', this.canvas.height);
            
            // Clear screen to verify WebGL is working
            gl.clearColor(0.2, 0.3, 0.4, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            console.log('WebGL clear test completed');
        } catch (error) {
            console.error('WebGL test failed:', error);
        }
    }

    public dispose() {
        // Clean up all resources
        this.stop();
        this.renderer.destroy();
        this.soundHandler.dispose();
        this.clearResourceCache();
        
        // Remove event listeners
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        this.canvas.removeEventListener('mouseup', this.handleMouseUp);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        
        // Clear maps
        this.interactiveObjects.clear();
        this.resourceCache.clear();
    }

    private clearResourceCache() {
        for (const [id, resource] of this.resourceCache) {
            if (resource instanceof WebGLTexture) {
                this.renderer.deleteTexture(id);
            }
            // Add other resource cleanup as needed
        }
        this.resourceCache.clear();
    }

    private animate() {
        if (!this.isPlaying) return;

        this.animationId = requestAnimationFrame(() => {
            const currentTime = performance.now();
            const deltaTime = currentTime - this.lastFrameTime;
            const frameDuration = 1000 / this.frameRate;

            if (deltaTime >= frameDuration) {
                this.timeline.nextFrame();
                this.render();
                this.lastFrameTime = currentTime;
            }

            this.animate();
        });
    }

    private render() {
        const displayList = this.timeline.getDisplayList();
        const objects = displayList.getObjects();

        if (objects.length === 0) {
            this.renderer.render([]);
            return;
        }

        // Batch objects by type for more efficient rendering
        const renderBatch = objects
            .filter(obj => obj.visible && obj.shape)
            .sort((a, b) => a.depth - b.depth)
            .map(obj => ({
                shape: obj.shape!,
                matrix: obj.matrix,
                colorTransform: obj.colorTransform,
                depth: obj.depth,
                characterId: obj.characterId,
                ratio: obj.ratio,
                mask: obj.clipDepth,
                isMask: obj.clipDepth !== undefined
            }));

        this.renderer.render(renderBatch);
    }
}

/**
 * SWF Player with comprehensive Flash feature support:
 * - Shape rendering (basic shapes, gradients, bitmaps)
 * - Sprites and nested timelines
 * - Masking and filters
 * - ActionScript and button interactivity
 * - Sound playback
 * - Color transforms and blend modes
 * - Resource management
 */
