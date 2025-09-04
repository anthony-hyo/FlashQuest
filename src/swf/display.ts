import { Shape } from './shapes';
import { Matrix, ColorTransform } from '../utils/bytes';

export interface DisplayObject {
	characterId: number;
	depth: number;
	matrix: Matrix;
	colorTransform?: ColorTransform;
	visible: boolean;
	shape?: Shape;
	bounds?: { xMin: number; xMax: number; yMin: number; yMax: number };
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

	addShape(characterId: number, shape: Shape) {
		this.shapes.set(characterId, shape);
	}

	getShape(characterId: number): Shape | undefined {
		return this.shapes.get(characterId);
	}

	placeObject(data: PlaceObjectData) {
		const existing = this.objects.get(data.depth);

		if (existing && !data.hasCharacter) {
			// Atualizar objeto existente
			if (data.hasMatrix) {
				existing.matrix = data.matrix!;
			}
			if (data.hasColorTransform) {
				existing.colorTransform = data.colorTransform;
			}
		} else {
			// Criar novo objeto
			const shape = data.characterId ? this.shapes.get(data.characterId) : undefined;

			const displayObject: DisplayObject = {
				characterId: data.characterId || 0,
				depth: data.depth,
				matrix: data.matrix || this.createIdentityMatrix(),
				colorTransform: data.colorTransform,
				visible: true,
				shape,
				bounds: shape?.bounds
			};

			this.objects.set(data.depth, displayObject);
		}
	}

	removeObject(depth: number) {
		this.objects.delete(depth);
	}

	getObjects(): DisplayObject[] {
		return Array.from(this.objects.values()).sort((a, b) => a.depth - b.depth);
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
	private currentFrame: number = 0;
	private displayList: DisplayList = new DisplayList();

	addFrame(frame: Frame) {
		this.frames.push(frame);
	}

	getCurrentFrame(): number {
		return this.currentFrame;
	}

	getTotalFrames(): number {
		return this.frames.length;
	}

	gotoFrame(frameNumber: number) {
		if (frameNumber < 0 || frameNumber >= this.frames.length) {
			return;
		}

		// Se estamos indo para trás, resetar display list
		if (frameNumber < this.currentFrame) {
			this.displayList.clear();
			this.currentFrame = 0;
		}

		// Executar todos os frames até o frame desejado
		while (this.currentFrame <= frameNumber) {
			const frame = this.frames[this.currentFrame];
			if (frame) {
				this.executeFrame(frame);
			}
			this.currentFrame++;
		}

		this.currentFrame = frameNumber;
	}

	nextFrame() {
		if (this.currentFrame < this.frames.length - 1) {
			this.gotoFrame(this.currentFrame + 1);
		} else {
			// Loop para o primeiro frame
			this.gotoFrame(0);
		}
	}

	getDisplayList(): DisplayList {
		return this.displayList;
	}

	private executeFrame(frame: Frame) {
		for (const action of frame.actions) {
			switch (action.type) {
				case 'placeObject':
					this.displayList.placeObject(action.data as PlaceObjectData);
					break;
				case 'removeObject':
					this.displayList.removeObject((action.data as any).depth);
					break;
				case 'defineShape':
					this.displayList.addShape(
						(action.data as any).characterId,
						(action.data as any).shape
					);
					break;
			}
		}
	}
}

export interface Frame {
	actions: FrameAction[];
	label?: string;
}

export interface FrameAction {
	type: 'placeObject' | 'removeObject' | 'defineShape' | 'setBackgroundColor';
	data: any;
}

