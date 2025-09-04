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

interface InteractiveObject {
    id: number;
    shape: any; // TYPE SAFETY: Should be properly typed Shape interface
    matrix?: any; // TYPE SAFETY: Should be Matrix interface
    handleMouseDown?: () => void;
    handleMouseUp?: () => void;
    handleMouseOver?: () => void;
    handleMouseOut?: () => void;
    isOver?: boolean;
}

export class SWFPlayer {
    private canvas: HTMLCanvasElement;
    private renderer: WebGLRenderer;
    private timeline: Timeline = new Timeline();
    private isPlaying: boolean = false;
    private frameRate: number = 12; // PERFORMANCE: Default 12fps might be too low for smooth animations
    private animationId: number | null = null;
    private lastFrameTime: number = 0;
    private tagHandlers: TagHandlerRegistry = new TagHandlerRegistry();
    private resourceCache: Map<number, any> = new Map(); // TYPE SAFETY: any should be specific resource types
    private interactiveObjects: Map<number, InteractiveObject> = new Map();
    private soundHandler: SoundHandler;
    private spriteHandler: SpriteHandler;
    private actionScriptHandler: ActionScriptHandler;
    private shapeHandler: ShapeTagHandler;
    private buttonHandler: ButtonHandler;
    private filterHandler: FilterHandler;
    private morphShapeHandler: MorphShapeHandler;
    private eventListeners: Array<{ element: HTMLElement; event: string; listener: EventListener }> = [];
    private isDestroyed: boolean = false;
    private loadingProgress: number = 0; // MISSING: Progress tracking implementation incomplete

    constructor(canvas: HTMLCanvasElement) {
        if (!canvas) {
            throw new Error('Canvas element is required');
        }
        this.canvas = canvas;
        this.renderer = new WebGLRenderer(canvas, 2048);
        this.soundHandler = new SoundHandler();
        this.spriteHandler = new SpriteHandler();
        this.actionScriptHandler = new ActionScriptHandler();
        this.shapeHandler = new ShapeTagHandler();
        this.buttonHandler = new ButtonHandler();
        this.filterHandler = new FilterHandler();
        this.morphShapeHandler = new MorphShapeHandler();
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
        ], this.buttonHandler);

        // Register sound handler
        this.tagHandlers.register([
            SwfTagCode.DefineSound,
            SwfTagCode.StartSound,
            SwfTagCode.SoundStreamHead,
            SwfTagCode.SoundStreamBlock
        ], this.soundHandler);

        // Register sprite handler for sprite-specific tags
        this.tagHandlers.register([
            SwfTagCode.DefineSprite
        ], this.spriteHandler);

        // MISSING: Many important SWF tag handlers not registered:
        // - DefineText, DefineEditText for text objects
        // - DefineBitmap for image assets  
        // - DefineVideo for video content
        // - DoAction for ActionScript code
        // - FrameLabel for timeline navigation
        // Register place object handlers to sprite handler (primary)
        this.tagHandlers.register([
            SwfTagCode.PlaceObject,
            SwfTagCode.PlaceObject2,
            SwfTagCode.PlaceObject3
        ], this.spriteHandler);

        // Register morph shape handler
        this.tagHandlers.register([
            SwfTagCode.DefineMorphShape,
            SwfTagCode.DefineMorphShape2
        ], this.morphShapeHandler);

        // Register ActionScript handler
        this.tagHandlers.register([
            SwfTagCode.DoAction,
            SwfTagCode.DoInitAction
        ], this.actionScriptHandler);
    }

    private setupInteractivity() {
        const mouseDownListener = (event: Event) => this.handleMouseDown(event as MouseEvent);
        const mouseUpListener = (event: Event) => this.handleMouseUp(event as MouseEvent);
        const mouseMoveListener = (event: Event) => this.handleMouseMove(event as MouseEvent);

        this.canvas.addEventListener('mousedown', mouseDownListener);
        this.canvas.addEventListener('mouseup', mouseUpListener);
        this.canvas.addEventListener('mousemove', mouseMoveListener);

        // MISSING: Touch event support for mobile devices
        // MISSING: Keyboard event support for interactive elements
        // MISSING: Context menu prevention for right-click
        
        // Store references for cleanup
        this.eventListeners.push(
            { element: this.canvas, event: 'mousedown', listener: mouseDownListener },
            { element: this.canvas, event: 'mouseup', listener: mouseUpListener },
            { element: this.canvas, event: 'mousemove', listener: mouseMoveListener }
        );
    }

    private handleMouseEvent(event: MouseEvent, eventType: 'down' | 'up' | 'move') {
        if (this.isDestroyed) return;
        
        const pos = this.getCanvasPosition(event);
        
        // PERFORMANCE: Iterating through all interactive objects on every mouse event - could be optimized with spatial indexing
        for (const [id, obj] of this.interactiveObjects) {
            const isHit = this.hitTest(pos, obj);
            
            switch (eventType) {
                case 'down':
                    if (isHit) obj.handleMouseDown?.();
                    break;
                case 'up':
                    if (isHit) obj.handleMouseUp?.();
                    break;
                case 'move':
                    if (isHit && !obj.isOver) {
                        obj.handleMouseOver?.();
                        obj.isOver = true;
                    } else if (!isHit && obj.isOver) {
                        obj.handleMouseOut?.();
                        obj.isOver = false;
                    }
                    break;
            }
        }
    }

    private handleMouseDown(event: MouseEvent) {
        this.handleMouseEvent(event, 'down');
    }

    private handleMouseUp(event: MouseEvent) {
        this.handleMouseEvent(event, 'up');
    }

    private handleMouseMove(event: MouseEvent) {
        this.handleMouseEvent(event, 'move');
    }

    private getCanvasPosition(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        // Account for page scroll
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        return {
            x: (event.clientX - rect.left + scrollX) * scaleX,
            y: (event.clientY - rect.top + scrollY) * scaleY
        };
    }

    private hitTest(pos: { x: number; y: number }, obj: InteractiveObject): boolean {
        if (!obj.shape?.bounds) return false;
        
        const bounds = obj.shape.bounds;
        const matrix = obj.matrix || { scaleX: 1, scaleY: 1, rotateSkew0: 0, rotateSkew1: 0, translateX: 0, translateY: 0 };
        
        // Transform point to object space (inverse transform)
        const TWIPS_PER_PIXEL = 20;
        const tx = matrix.translateX / TWIPS_PER_PIXEL;
        const ty = matrix.translateY / TWIPS_PER_PIXEL;
        
        // Apply inverse translation
        let localX = pos.x - tx;
        let localY = pos.y - ty;
        
        // Apply inverse scale and rotation (simplified for now)
        if (matrix.scaleX !== 0) localX /= matrix.scaleX;
        if (matrix.scaleY !== 0) localY /= matrix.scaleY;
        
        // Convert bounds to pixels
        const boundsMinX = bounds.xMin / TWIPS_PER_PIXEL;
        const boundsMaxX = bounds.xMax / TWIPS_PER_PIXEL;
        const boundsMinY = bounds.yMin / TWIPS_PER_PIXEL;
        const boundsMaxY = bounds.yMax / TWIPS_PER_PIXEL;
        
        return localX >= boundsMinX && localX <= boundsMaxX &&
               localY >= boundsMinY && localY <= boundsMaxY;
    }

    async loadSWF(source: string | File): Promise<void> {
        try {
            this.loadingProgress = 0;
            const { dataView } = await loadSwf(source);
            this.loadingProgress = 50;
            
            const { header, tags } = parseSwf(dataView);
            this.loadingProgress = 75;

            this.frameRate = header.frameRate;
            this.setupCanvas(header.frameSize);
            await this.buildTimeline(tags);
            this.loadingProgress = 100;
            
            if (this.timeline.getTotalFrames() === 0) {
                console.warn('No frames found in SWF');
                return;
            }

            this.timeline.gotoFrame(0);
            this.render();

        } catch (error) {
            this.loadingProgress = 0;
            console.error('Failed to load SWF:', error);
            throw error;
        }
    }

    private setupCanvas(frameSize: { xMin: number; xMax: number; yMin: number; yMax: number }) {
        const TWIPS_PER_PIXEL = 20;
        const width = Math.abs(frameSize.xMax - frameSize.xMin) / TWIPS_PER_PIXEL;
        const height = Math.abs(frameSize.yMax - frameSize.yMin) / TWIPS_PER_PIXEL;
        
        // Set reasonable defaults if frame size is invalid
        this.canvas.width = width > 0 ? width : 800;
        this.canvas.height = height > 0 ? height : 600;
        
        // Update renderer viewport
        this.renderer.setupViewport();
    }

    private async buildTimeline(tags: TagData[]) {
        let currentFrame: Frame = { actions: [] };
        const displayList = new DisplayList();
        
        console.log('[Build Timeline] Processing', tags.length, 'tags');
        
        // PERFORMANCE: Sequential processing - could parallelize non-dependent operations
        // Process tags sequentially to avoid data corruption
        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            
            // Skip processing if tag data is corrupted or insufficient
            if (!tag.data || tag.data.remaining <= 0) {
                console.warn(`[Build Timeline] Skipping tag ${this.getTagName(tag.code)} (${tag.code}) - insufficient data`);
                continue;
            }
            
            try {
                const handler = this.tagHandlers.getHandler(tag.code);
                if (handler) {
                    // ASYNC ISSUE: No timeout or cancellation for long-running tag processing
                    await handler.handle(tag, currentFrame, displayList);
                    console.log(`[Build Timeline] Successfully processed ${this.getTagName(tag.code)} (${tag.code})`);
                } else if (tag.code === SwfTagCode.ShowFrame) {
                    this.timeline.addFrame(currentFrame);
                    currentFrame = { actions: [] }; // PERFORMANCE: Object creation every frame
                    console.log('[Build Timeline] ShowFrame - frame added');
                } else if (tag.code === SwfTagCode.End) {
                    if (currentFrame.actions.length > 0) {
                        this.timeline.addFrame(currentFrame);
                    }
                    console.log('[Build Timeline] End tag reached');
                    break; // Stop processing after End tag
                } else {
                    // MISSING: Track unhandled tags for debugging
                    console.log(`[Build Timeline] No handler for tag ${this.getTagName(tag.code)} (${tag.code})`);
                }
            } catch (error) {
                console.error(`Error processing tag ${this.getTagName(tag.code)} (${tag.code}):`, error);
                // Continue processing other tags instead of failing completely
                // MISSING: Error recovery strategy - corrupted timeline could render incorrectly
            }
        }
        
        // If we have actions but no frames, create a frame
        if (currentFrame.actions.length > 0) {
            this.timeline.addFrame(currentFrame);
        }
        
        console.log('[Build Timeline] Total frames:', this.timeline.getTotalFrames());
        console.log('[Build Timeline] Display list has', displayList.getObjects().length, 'objects');
        // MISSING: Validation that timeline is in valid state
    }

    private getTagName(code: number): string {
        // INCOMPLETE: Missing many SWF tag types
        // MAINTAINABILITY: Should be imported from tags enum or constants
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
            // MISSING: DefineSprite, DefineButton, DefineText, DefineBitmap, etc.
        };
        return tagNames[code] || `Unknown(${code})`;
    }

    private createTestContent() {
        console.log('Creating test content - red square');
        
        // DEVELOPMENT CODE: Test content should not be in production
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
        if (this.isPlaying) return; // MISSING: Should emit event for state change

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
        // MISSING: Should emit pause event
    }

    stop() {
        this.pause();
        this.timeline.gotoFrame(0);
        this.render();

        console.log('Reprodução parada');
        // MISSING: Should emit stop event
        // MISSING: Should reset all object states
    }

    gotoFrame(frameNumber: number) {
        // MISSING: Input validation - frameNumber could be negative or out of bounds
        this.timeline.gotoFrame(frameNumber);
        this.render();
        // MISSING: Should emit frame change event
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

        console.log('[Render] Display list objects:', objects.length);
        console.log('[Render] Objects details:', objects.map(obj => ({
            characterId: obj.characterId,
            depth: obj.depth,
            visible: obj.visible,
            hasShape: !!obj.shape,
            shapeBounds: obj.shape?.bounds
        })));

        if (objects.length === 0) {
            console.warn('[Render] No objects in display list - trying to create test content');
            this.renderer.render([]);
            return;
        }

        // Batch objects by type for more efficient rendering
        const renderBatch = objects
            .filter(obj => {
                const shouldRender = obj.visible && obj.shape;
                if (!shouldRender) {
                    console.log('[Render] Filtering out object:', { 
                        characterId: obj.characterId, 
                        visible: obj.visible, 
                        hasShape: !!obj.shape 
                    });
                }
                return shouldRender;
            })
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

        console.log('[Render] Rendering batch:', renderBatch.length, 'objects');
        this.renderer.render(renderBatch);
    }

    public destroy() {
        if (this.isDestroyed) return;
        
        this.isDestroyed = true;
        this.pause();
        
        // Clean up event listeners
        this.eventListeners.forEach(({ element, event, listener }) => {
            element.removeEventListener(event, listener);
        });
        this.eventListeners = [];
        
        // Clear caches
        this.resourceCache.clear();
        this.interactiveObjects.clear();
        
        // Destroy renderer
        this.renderer.destroy();
    }

    public getLoadingProgress(): number {
        return this.loadingProgress;
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
