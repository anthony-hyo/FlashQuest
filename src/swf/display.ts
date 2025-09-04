import { Shape } from './shapes';
import { MorphShape } from './morph-shapes';
import { Matrix, ColorTransform } from '../utils/bytes';

export interface DisplayObject {
	characterId: number;
	depth: number;
	matrix: Matrix;
	colorTransform?: ColorTransform;
	visible: boolean;
	shape?: Shape;
	sprite?: SpriteInstance;
	bounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
	ratio?: number;       // For morph shapes
	clipDepth?: number;   // For masking
	isMask?: boolean;     // Whether this object is a mask
}

export interface SpriteDefinition {
	characterId: number;
	frameCount: number;
	timeline: Timeline;
	bounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export interface SpriteInstance {
	definition: SpriteDefinition;
	currentFrame: number;
	playing: boolean;
	displayList: DisplayList;
}

export interface PlaceObjectData {
	characterId?: number;
	depth: number;
	matrix?: Matrix;
	colorTransform?: ColorTransform;
	ratio?: number;
	name?: string;
	clipDepth?: number;
	clipActions?: any;
	hasClipActions?: boolean;
	hasClipDepth?: boolean;
	hasName?: boolean;
	hasRatio?: boolean;
	hasColorTransform?: boolean;
	hasMatrix?: boolean;
	hasCharacter?: boolean;
	hasMove?: boolean;
}

export class DisplayList {
	private objects: Map<number, DisplayObject> = new Map();
	private shapes: Map<number, Shape> = new Map();
	private morphShapes: Map<number, MorphShape> = new Map();
	private sprites: Map<number, SpriteDefinition> = new Map();

	addShape(characterId: number, shape: Shape) {
		this.shapes.set(characterId, shape);
		console.log('[DisplayList] addShape:', { characterId, shape });
	}

	addMorphShape(characterId: number, morphShape: MorphShape) {
		this.morphShapes.set(characterId, morphShape);
		console.log('[DisplayList] addMorphShape:', { characterId, morphShape });
	}

	addSprite(characterId: number, sprite: SpriteDefinition) {
		this.sprites.set(characterId, sprite);
		console.log('[DisplayList] addSprite:', { characterId, frameCount: sprite.frameCount });
	}

	getMorphShape(characterId: number): MorphShape | undefined {
		return this.morphShapes.get(characterId);
	}

	getShape(characterId: number): Shape | undefined {
		return this.shapes.get(characterId);
	}

	placeObject(data: PlaceObjectData) {
		const existing = this.objects.get(data.depth);

		if (existing && !data.hasCharacter) {
			// Update existing object
			if (data.hasMatrix) {
				existing.matrix = data.matrix!;
			}
			if (data.hasColorTransform) {
				existing.colorTransform = data.colorTransform;
			}
			if (data.hasRatio && existing.ratio !== undefined) {
				existing.ratio = data.ratio;
			}
			console.log('[DisplayList] Updated existing object at depth', data.depth, existing);
		} else {
			// Create new object
			let shape: Shape | undefined = undefined;
			let morphShape: MorphShape | undefined = undefined;
			let sprite: SpriteInstance | undefined = undefined;
			
			if (data.characterId) {
				shape = this.shapes.get(data.characterId);
				morphShape = this.morphShapes.get(data.characterId);
				
				// Check if it's a sprite
				const spriteDefinition = this.sprites.get(data.characterId);
				if (spriteDefinition) {
					sprite = {
						definition: spriteDefinition,
						currentFrame: 0,
						playing: true,
						displayList: new DisplayList()
					};
					console.log('[DisplayList] Created sprite instance:', { characterId: data.characterId, frameCount: spriteDefinition.frameCount });
				}
			}

			let displayShape: Shape | undefined = shape;
			let ratio = data.ratio ?? 0;
			let type = 'shape';
			
			if (morphShape) {
				// Interpolate morph shape for the given ratio
				displayShape = this.interpolateMorphShape(morphShape, ratio);
				type = 'morphShape';
			} else if (sprite) {
				type = 'sprite';
			}

			const displayObject: DisplayObject = {
				characterId: data.characterId || 0,
				depth: data.depth,
				matrix: data.matrix || this.createIdentityMatrix(),
				colorTransform: data.colorTransform,
				visible: true,
				shape: displayShape,
				sprite: sprite,
				bounds: displayShape?.bounds,
				ratio: morphShape ? ratio : undefined
			};

			this.objects.set(data.depth, displayObject);
			console.log('[DisplayList] Placed new object:', { type, characterId: data.characterId, depth: data.depth, displayObject });
		}
	}

	   private interpolateMorphShape(morphShape: MorphShape, ratio: number): Shape {
		   // Clamp ratio
		   ratio = Math.max(0, Math.min(1, ratio));
		   // Simple linear interpolation for bounds, fillStyles, lineStyles, and records
		   // You may want to use a more advanced interpolation depending on your needs
		   const lerp = (a: number, b: number) => a + (b - a) * ratio;
		   const bounds = {
			   xMin: lerp(morphShape.startShape.bounds.xMin, morphShape.endShape.bounds.xMin),
			   xMax: lerp(morphShape.startShape.bounds.xMax, morphShape.endShape.bounds.xMax),
			   yMin: lerp(morphShape.startShape.bounds.yMin, morphShape.endShape.bounds.yMin),
			   yMax: lerp(morphShape.startShape.bounds.yMax, morphShape.endShape.bounds.yMax)
		   };
		   // For now, just use startShape's fillStyles, lineStyles, and records (no morphing)
		   // TODO: Implement full interpolation for fillStyles, lineStyles, and records
		   return {
			   bounds,
			   fillStyles: morphShape.startShape.fillStyles,
			   lineStyles: morphShape.startShape.lineStyles,
			   records: morphShape.startShape.records
		   };
	   }

	removeObject(depth: number) {
		this.objects.delete(depth);
	}

	getObjects(): DisplayObject[] {
		const objs = Array.from(this.objects.values()).sort((a, b) => a.depth - b.depth);
		console.log('[DisplayList] getObjects:', objs);
		return objs;
	}

	clear() {
		this.objects.clear();
	}

	private createIdentityMatrix(): Matrix {
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

export class Timeline {
	private frames: Frame[] = [];
	private currentFrame: number = -1; // -1 means nothing executed yet
	private displayList: DisplayList = new DisplayList();

	addFrame(frame: Frame) {
		this.frames.push(frame);
	}

	getCurrentFrame(): number {
		return this.currentFrame < 0 ? 0 : this.currentFrame;
	}

	getTotalFrames(): number {
		return this.frames.length;
	}

	gotoFrame(frameNumber: number) {
		if (frameNumber < 0 || frameNumber >= this.frames.length) {
			return;
		}

		// If seeking backwards, reset and rebuild from start
		if (frameNumber < this.currentFrame) {
			this.displayList.clear();
			this.currentFrame = -1;
		}

		// Execute frames incrementally up to requested frame
		for (let i = this.currentFrame + 1; i <= frameNumber; i++) {
			const frame = this.frames[i];
			if (frame) {
				this.executeFrame(frame);
			}
			this.currentFrame = i;
		}
	}

	nextFrame() {
		if (this.frames.length === 0) return;
		if (this.currentFrame >= this.frames.length - 1) {
			// loop
			this.displayList.clear();
			this.currentFrame = -1;
			this.gotoFrame(0);
		} else {
			this.gotoFrame(this.currentFrame + 1);
		}
	}

	getDisplayList(): DisplayList {
		return this.displayList;
	}

	private executeFrame(frame: Frame) {
		// Track which shapes have been explicitly placed
		const explicitlyPlaced = new Set<number>();
		for (const action of frame.actions) {
			switch (action.type) {
				case 'placeObject':
					this.displayList.placeObject(action.data as PlaceObjectData);
					if (action.data.characterId) explicitlyPlaced.add(action.data.characterId);
					break;
				case 'removeObject':
					this.displayList.removeObject((action.data as any).depth);
					break;
				case 'defineShape':
					this.displayList.addShape(action.data.characterId, action.data.shape);
					// Auto-place the shape if no explicit PlaceObject will follow (Flash default)
					if (!explicitlyPlaced.has(action.data.characterId)) {
						this.displayList.placeObject({
							characterId: action.data.characterId,
							depth: action.data.characterId,
							hasCharacter: true,
							hasMatrix: false,
							hasColorTransform: false
						});
						explicitlyPlaced.add(action.data.characterId);
						console.log('[Timeline] Auto-placed shape at depth', action.data.characterId);
					}
					console.log('[Timeline] Shape defined, characterId:', action.data.characterId);
					break;
				case 'defineBits':
					// Handled by renderer
					break;
				case 'setBackgroundColor':
					// Handled by renderer
					break;
				case 'defineButton':
					// Register interactive button
					this.registerButton(action.data);
					break;
				case 'doAction':
					this.executeAction(action.data);
					break;
				case 'doInitAction':
					this.executeInitAction(action.data);
					break;
				case 'defineSprite':
					this.registerSprite(action.data);
					break;
				case 'defineMorphShape':
					this.registerMorphShape(action.data);
					break;
				case 'defineSound':
					// Handled by sound handler
					break;
				case 'startSound':
					// Handled by sound handler
					break;
				case 'soundStreamHead':
					// Handled by sound handler
					break;
				case 'soundStreamBlock':
					// Handled by sound handler
					break;
			}
		}
	}

	private registerButton(data: any) {
		// Implementation will be added with button support
	}

	private executeAction(data: any) {
		// Implementation will be added with ActionScript support
	}

	private executeInitAction(data: any) {
		// Implementation will be added with ActionScript support
	}

	private registerSprite(data: any) {
		console.log('[Timeline] Registering sprite:', data);
		if (this.displayList) {
			this.displayList.addSprite(data.characterId, {
				characterId: data.characterId,
				frameCount: data.frameCount,
				timeline: data.timeline,
				bounds: data.bounds
			});
		}
	}

	   private registerMorphShape(data: any) {
		   // data: { characterId, morphShape }
		   if (!data || typeof data.characterId !== 'number' || !data.morphShape) {
			   console.warn('[Timeline] Invalid morph shape registration data', data);
			   return;
		   }
		   // Register morph shape in display list
		   this.displayList.addMorphShape(data.characterId, data.morphShape);
		   // Optionally, auto-place the morph shape at depth = characterId (or another default)
		   // This is similar to how defineShape is auto-placed
		   // You may want to adjust this logic depending on your SWF structure
		   this.displayList.placeObject({
			   characterId: data.characterId,
			   depth: data.characterId, // Use characterId as default depth if not specified
			   hasCharacter: true,
			   hasMatrix: false,
			   hasColorTransform: false,
			   hasRatio: true,
			   ratio: 0 // Start at ratio 0 (fully startShape)
		   });
		   console.log('[Timeline] MorphShape defined and placed, characterId:', data.characterId);
	   }
}

export interface Frame {
	actions: {
		type: 'placeObject' | 'removeObject' | 'defineShape' | 'setBackgroundColor' | 'defineBits' |
			  'defineButton' | 'doAction' | 'doInitAction' | 'defineSprite' | 'defineMorphShape' |
			  'defineSound' | 'startSound' | 'soundStreamHead' | 'soundStreamBlock';
		data: any;
	}[];
}
