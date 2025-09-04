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
import { Matrix } from './utils/bytes';

interface Shape {
    readonly id: number;
    readonly fillStyles?: any[];
    readonly lineStyles?: any[];
    readonly paths?: any[];
    readonly bounds?: {
        readonly xMin: number;
        readonly xMax: number;
        readonly yMin: number;
        readonly yMax: number;
    };
}

interface SWFResource {
    id: number;
    type: 'shape' | 'sprite' | 'sound' | 'bitmap' | 'font';
    data: any;
}

interface MouseEventHandler {
    (): void;
}

interface TouchEventHandler {
    (touches: TouchList): void;
}

interface KeyboardEventHandler {
    (key: string, isPressed: boolean): void;
}

interface InteractiveObject {
    readonly id: number;
    readonly shape: Shape;
    readonly matrix?: Matrix;
    readonly handleMouseDown?: MouseEventHandler;
    readonly handleMouseUp?: MouseEventHandler;
    readonly handleMouseOver?: MouseEventHandler;
    readonly handleMouseOut?: MouseEventHandler;
    readonly handleTouchStart?: TouchEventHandler;
    readonly handleTouchEnd?: TouchEventHandler;
    isOver?: boolean;
    isPressed?: boolean;
}

interface EventListenerInfo {
    element: HTMLElement;
    event: string;
    listener: EventListener;
}

export interface SWFPlayerConfig {
    frameRate?: number;
    enableSound?: boolean;
    enableInteractivity?: boolean;
    maxTextureSize?: number;
    backgroundColor?: string;
}

export interface SWFPlayerEventMap {
    'play': void;
    'pause': void;
    'stop': void;
    'frameChange': { frame: number; totalFrames: number };
    'loadProgress': { loaded: number; total: number };
    'loadComplete': void;
    'error': Error;
}

export type SWFPlayerEvent = keyof SWFPlayerEventMap;

export class SWFPlayer {
    private readonly canvas: HTMLCanvasElement;
    private readonly renderer: WebGLRenderer;
    private readonly timeline: Timeline;
    private readonly tagHandlers: TagHandlerRegistry;
    private readonly resourceCache: Map<number, SWFResource> = new Map();
    private readonly interactiveObjects: Map<number, InteractiveObject> = new Map();
    private readonly eventListeners: EventListenerInfo[] = [];
    private readonly playerEventListeners: Map<SWFPlayerEvent, Set<Function>> = new Map();
    
    private isPlaying: boolean = false;
    private frameRate: number = 30;
    private animationId: number | null = null;
    private lastFrameTime: number = 0;
    private loadingProgress: number = 0;
    private isDestroyed: boolean = false;
    
    // Performance optimization: reuse frame objects
    private framePool: Frame[] = [];
    
    // Handlers
    private readonly soundHandler: SoundHandler;
    private readonly spriteHandler: SpriteHandler;
    private readonly actionScriptHandler: ActionScriptHandler;
    private readonly shapeHandler: ShapeTagHandler;
    private readonly buttonHandler: ButtonHandler;
    private readonly filterHandler: FilterHandler;
    private readonly morphShapeHandler: MorphShapeHandler;
    
    // Input state
    private mousePosition: { x: number; y: number } = { x: 0, y: 0 };
    private pressedKeys: Set<string> = new Set();
    private activeTouches: Map<number, { x: number; y: number }> = new Map();

    constructor(canvas: HTMLCanvasElement, config: SWFPlayerConfig = {}) {
        if (!canvas) {
            throw new Error('Canvas element is required');
        }
        
        this.canvas = canvas;
        this.frameRate = config.frameRate ?? 30;
        
        this.renderer = new WebGLRenderer(canvas, config.maxTextureSize ?? 2048);
        this.timeline = new Timeline();
        this.tagHandlers = new TagHandlerRegistry();
        
        // Initialize handlers
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
        // Mouse events
        const mouseDownListener = (event: Event) => this.handleMouseDown(event as MouseEvent);
        const mouseUpListener = (event: Event) => this.handleMouseUp(event as MouseEvent);
        const mouseMoveListener = (event: Event) => this.handleMouseMove(event as MouseEvent);
        const contextMenuListener = (event: Event) => {
            event.preventDefault(); // Prevent right-click context menu
            return false;
        };

        this.canvas.addEventListener('mousedown', mouseDownListener);
        this.canvas.addEventListener('mouseup', mouseUpListener);
        this.canvas.addEventListener('mousemove', mouseMoveListener);
        this.canvas.addEventListener('contextmenu', contextMenuListener);

        // Touch events for mobile devices
        const touchStartListener = (event: Event) => this.handleTouchStart(event as TouchEvent);
        const touchEndListener = (event: Event) => this.handleTouchEnd(event as TouchEvent);
        const touchMoveListener = (event: Event) => this.handleTouchMove(event as TouchEvent);
        const touchCancelListener = (event: Event) => this.handleTouchCancel(event as TouchEvent);

        this.canvas.addEventListener('touchstart', touchStartListener, { passive: false });
        this.canvas.addEventListener('touchend', touchEndListener, { passive: false });
        this.canvas.addEventListener('touchmove', touchMoveListener, { passive: false });
        this.canvas.addEventListener('touchcancel', touchCancelListener, { passive: false });

        // Keyboard events for interactive elements
        const keyDownListener = (event: Event) => this.handleKeyDown(event as KeyboardEvent);
        const keyUpListener = (event: Event) => this.handleKeyUp(event as KeyboardEvent);

        // Make canvas focusable for keyboard events
        this.canvas.tabIndex = 0;
        this.canvas.addEventListener('keydown', keyDownListener);
        this.canvas.addEventListener('keyup', keyUpListener);

        // Store references for cleanup
        this.eventListeners.push(
            { element: this.canvas, event: 'mousedown', listener: mouseDownListener },
            { element: this.canvas, event: 'mouseup', listener: mouseUpListener },
            { element: this.canvas, event: 'mousemove', listener: mouseMoveListener },
            { element: this.canvas, event: 'contextmenu', listener: contextMenuListener },
            { element: this.canvas, event: 'touchstart', listener: touchStartListener },
            { element: this.canvas, event: 'touchend', listener: touchEndListener },
            { element: this.canvas, event: 'touchmove', listener: touchMoveListener },
            { element: this.canvas, event: 'touchcancel', listener: touchCancelListener },
            { element: this.canvas, event: 'keydown', listener: keyDownListener },
            { element: this.canvas, event: 'keyup', listener: keyUpListener }
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
        this.mousePosition = this.getCanvasPosition(event);
        this.handleMouseEvent(event, 'down');
    }

    private handleMouseUp(event: MouseEvent) {
        this.mousePosition = this.getCanvasPosition(event);
        this.handleMouseEvent(event, 'up');
    }

    private handleMouseMove(event: MouseEvent) {
        this.mousePosition = this.getCanvasPosition(event);
        this.handleMouseEvent(event, 'move');
    }

    // Touch event handlers
    private handleTouchStart(event: TouchEvent) {
        event.preventDefault(); // Prevent mouse events from firing
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const pos = this.getTouchPosition(touch);
            this.activeTouches.set(touch.identifier, pos);
            
            // Simulate mouse down for first touch
            if (this.activeTouches.size === 1) {
                this.mousePosition = pos;
                this.handleTouchEvent(touch, 'down');
            }
        }
    }

    private handleTouchEnd(event: TouchEvent) {
        event.preventDefault();
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const pos = this.getTouchPosition(touch);
            this.activeTouches.delete(touch.identifier);
            
            // Simulate mouse up for primary touch
            if (this.activeTouches.size === 0) {
                this.mousePosition = pos;
                this.handleTouchEvent(touch, 'up');
            }
        }
    }

    private handleTouchMove(event: TouchEvent) {
        event.preventDefault();
        for (let i = 0; i < event.changedTouches.length; i++) {
            const touch = event.changedTouches[i];
            const pos = this.getTouchPosition(touch);
            this.activeTouches.set(touch.identifier, pos);
            
            // Update mouse position for primary touch
            if (touch.identifier === Array.from(this.activeTouches.keys())[0]) {
                this.mousePosition = pos;
                this.handleTouchEvent(touch, 'move');
            }
        }
    }

    private handleTouchCancel(event: TouchEvent) {
        event.preventDefault();
        this.activeTouches.clear();
    }

    // Keyboard event handlers
    private handleKeyDown(event: KeyboardEvent) {
        const key = event.code || event.key;
        if (!this.pressedKeys.has(key)) {
            this.pressedKeys.add(key);
            this.handleKeyboardEvent(key, true);
        }
    }

    private handleKeyUp(event: KeyboardEvent) {
        const key = event.code || event.key;
        this.pressedKeys.delete(key);
        this.handleKeyboardEvent(key, false);
    }

    private getTouchPosition(touch: Touch): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        return {
            x: (touch.clientX - rect.left) * scaleX,
            y: (touch.clientY - rect.top) * scaleY
        };
    }

    private handleTouchEvent(touch: Touch, eventType: 'down' | 'up' | 'move') {
        if (this.isDestroyed) return;
        
        const pos = this.getTouchPosition(touch);
        
        // Create a TouchList-like object
        const touchList = {
            length: 1,
            item: (index: number) => index === 0 ? touch : null,
            [0]: touch
        } as unknown as TouchList;
        
        for (const [id, obj] of this.interactiveObjects) {
            const isHit = this.hitTest(pos, obj);
            
            switch (eventType) {
                case 'down':
                    if (isHit) {
                        obj.handleTouchStart?.(touchList);
                        obj.handleMouseDown?.(); // Fallback to mouse handler
                        obj.isPressed = true;
                    }
                    break;
                case 'up':
                    if (obj.isPressed) {
                        obj.handleTouchEnd?.(touchList);
                        obj.handleMouseUp?.(); // Fallback to mouse handler
                        obj.isPressed = false;
                    }
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

    private handleKeyboardEvent(key: string, isPressed: boolean) {
        if (this.isDestroyed) return;
        
        // Handle global keyboard events (could be extended for ActionScript)
        // For now, just log for debugging
        console.log(`Key ${key} ${isPressed ? 'pressed' : 'released'}`);
        
        // Trigger keyboard handlers on interactive objects if they support it
        for (const [id, obj] of this.interactiveObjects) {
            // Future: Add keyboard handler support to InteractiveObject interface
        }
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
            
            // Force a second render after a small delay to ensure all data is properly loaded
            // This addresses an issue where initial render may use cached/stale data
            setTimeout(() => {
                console.log('[SWF] Performing delayed refresh render to ensure correct colors');
                this.render();
            }, 50);

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
        let currentFrame: Frame = this.getFrameFromPool();
        const displayList = new DisplayList();
        
        console.log('[Build Timeline] Processing', tags.length, 'tags');
        
        const unhandledTags = new Set<number>();
        
        // Process tags sequentially to maintain dependencies
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
                    await handler.handle(tag, currentFrame, displayList);
                    console.log(`[Build Timeline] Successfully processed ${this.getTagName(tag.code)} (${tag.code})`);
                } else if (tag.code === SwfTagCode.ShowFrame) {
                    this.timeline.addFrame(currentFrame);
                    currentFrame = this.getFrameFromPool();
                    console.log('[Build Timeline] ShowFrame - frame added');
                } else if (tag.code === SwfTagCode.End) {
                    if (currentFrame.actions.length > 0) {
                        this.timeline.addFrame(currentFrame);
                    } else {
                        this.returnFrameToPool(currentFrame);
                    }
                    console.log('[Build Timeline] End tag reached');
                    break; // Stop processing after End tag
                } else {
                    if (!unhandledTags.has(tag.code)) {
                        unhandledTags.add(tag.code);
                        console.log(`[Build Timeline] No handler for tag ${this.getTagName(tag.code)} (${tag.code})`);
                    }
                }
            } catch (error) {
                console.error(`Error processing tag ${this.getTagName(tag.code)} (${tag.code}):`, error);
                // Continue processing other tags instead of failing completely
                this.emit('error', error instanceof Error ? error : new Error(String(error)));
            }
        }
        
        // If we have actions but no frames, create a frame
        if (currentFrame.actions.length > 0) {
            this.timeline.addFrame(currentFrame);
        } else {
            // Return unused frame to pool
            this.returnFrameToPool(currentFrame);
        }
        
        if (unhandledTags.size > 0) {
            console.warn(`[Build Timeline] ${unhandledTags.size} unhandled tag types:`, Array.from(unhandledTags).map(code => `${this.getTagName(code)}(${code})`));
        }
        
        console.log('[Build Timeline] Total frames:', this.timeline.getTotalFrames());
        console.log('[Build Timeline] Display list has', displayList.getObjects().length, 'objects');
        
        // Validate timeline state
        if (this.timeline.getTotalFrames() === 0) {
            console.warn('[Build Timeline] No frames created - SWF may not display correctly');
        }
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

    // Event system
    addEventListener<T extends SWFPlayerEvent>(event: T, listener: (data: SWFPlayerEventMap[T]) => void): void {
        if (!this.playerEventListeners.has(event)) {
            this.playerEventListeners.set(event, new Set());
        }
        this.playerEventListeners.get(event)!.add(listener);
    }

    removeEventListener<T extends SWFPlayerEvent>(event: T, listener: (data: SWFPlayerEventMap[T]) => void): void {
        const listeners = this.playerEventListeners.get(event);
        if (listeners) {
            listeners.delete(listener);
        }
    }

    private emit<T extends SWFPlayerEvent>(event: T, data: SWFPlayerEventMap[T]): void {
        const listeners = this.playerEventListeners.get(event);
        if (listeners) {
            listeners.forEach(listener => {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`Error in ${event} event listener:`, error);
                }
            });
        }
    }

    private getFrameFromPool(): Frame {
        return this.framePool.pop() || { actions: [] };
    }

    private returnFrameToPool(frame: Frame): void {
        frame.actions.length = 0; // Clear actions
        if (this.framePool.length < 100) { // Limit pool size
            this.framePool.push(frame);
        }
    }

    play() {
        if (this.isPlaying) {
            return;
        }

        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this.animate();
        this.emit('play', undefined);

        console.log('Reprodução iniciada');
    }

    pause() {
        if (!this.isPlaying) {
            return;
        }
        
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.emit('pause', undefined);
        console.log('Reprodução pausada');
    }

    stop() {
        this.pause();
        this.timeline.gotoFrame(0);
        this.render();
        
        // Reset all interactive object states
        for (const [id, obj] of this.interactiveObjects) {
            if ('isOver' in obj) obj.isOver = false;
            if ('isPressed' in obj) obj.isPressed = false;
        }
        
        this.emit('stop', undefined);
        console.log('Reprodução parada');
    }

    gotoFrame(frameNumber: number) {
        const totalFrames = this.timeline.getTotalFrames();
        
        // Input validation
        if (frameNumber < 0) {
            frameNumber = 0;
        } else if (frameNumber >= totalFrames) {
            frameNumber = Math.max(0, totalFrames - 1);
        }
        
        const currentFrame = this.timeline.getCurrentFrame();
        if (currentFrame !== frameNumber) {
            this.timeline.gotoFrame(frameNumber);
            this.render();
            this.emit('frameChange', { frame: frameNumber, totalFrames });
        }
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
        
        // Reset timeline by going to frame 0
        this.timeline.gotoFrame(0);
        
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
        this.eventListeners.length = 0; // Clear array without reassigning
        
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
