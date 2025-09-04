import { loadSwf } from './swf/loader';
import { parseSwf } from './swf/parser';
import { parseShape } from './swf/shapes';
import { WebGLRenderer, RenderObject } from './gl/renderer';
import { DisplayList, Timeline, Frame, FrameAction, PlaceObjectData } from './swf/display';
import {SWFFileHeader, SwfTagCode} from "./tags/tags";
import { Bytes } from './utils/bytes';

export class SWFPlayer {
	private canvas: HTMLCanvasElement;
	private renderer: WebGLRenderer;
	private timeline: Timeline = new Timeline();
	private isPlaying: boolean = false;
	private frameRate: number = 12;
	private animationId: number | null = null;
	private lastFrameTime: number = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.renderer = new WebGLRenderer(canvas);
	}

	async loadSWF(source: string | File): Promise<void> {
		try {
			console.log('Carregando SWF...');
			const { header: fileHeader, dataView } = await loadSwf(source);

			console.log('Parseando SWF...');
			const { header, tags } = parseSwf(dataView);

			this.frameRate = header.frameRate;

			// Configurar canvas
			const width = Math.abs(header.frameSize.xMax - header.frameSize.xMin) / 20;
			const height = Math.abs(header.frameSize.yMax - header.frameSize.yMin) / 20;

			this.canvas.width = Math.min(width, 1200) || 800;
			this.canvas.height = Math.min(height, 800) || 600;

			console.log(`Dimensões: ${this.canvas.width}x${this.canvas.height}`);
			console.log(`Frame rate: ${this.frameRate} fps`);
			console.log(`Total de tags: ${tags.length}`);

			// Processar tags e construir timeline
			this.buildTimeline(tags);

			// Renderizar primeiro frame
			this.timeline.gotoFrame(0);
			this.render();

			console.log('SWF carregado com sucesso!');

		} catch (error) {
			console.error('Erro ao carregar SWF:', error);
			throw error;
		}
	}

	private buildTimeline(tags: any[]) {
		let currentFrame: Frame = { actions: [] };
		const displayList = new DisplayList();

		for (const tag of tags) {
			try {
				tag.data.position = 0;
				tag.data.bitPosition = 0;

				switch (tag.code) {
					case SwfTagCode.DefineShape:
					case SwfTagCode.DefineShape2:
					case SwfTagCode.DefineShape3:
					case SwfTagCode.DefineShape4:
						this.processDefineShape(tag, currentFrame, displayList);
						break;

					case SwfTagCode.PlaceObject:
					case SwfTagCode.PlaceObject2:
					case SwfTagCode.PlaceObject3:
						this.processPlaceObject(tag, currentFrame);
						break;

					case SwfTagCode.RemoveObject:
					case SwfTagCode.RemoveObject2:
						this.processRemoveObject(tag, currentFrame);
						break;

					case SwfTagCode.SetBackgroundColor:
						this.processSetBackgroundColor(tag, currentFrame);
						break;

					case SwfTagCode.ShowFrame:
						this.timeline.addFrame(currentFrame);
						currentFrame = { actions: [] };
						break;

					case SwfTagCode.End:
						if (currentFrame.actions.length > 0) {
							this.timeline.addFrame(currentFrame);
						}
						break;

					default:
						// Ignorar tags não implementadas
						break;
				}
			} catch (error) {
				console.error(`Erro ao processar tag ${tag.code}:`, error);
			}
		}

		console.log(`Timeline construída com ${this.timeline.getTotalFrames()} frames`);
	}

	private processDefineShape(tag: any, currentFrame: Frame, displayList: DisplayList) {
		const data = tag.data;
		const characterId = data.readUint16();

		try {
			const shape = parseShape(data, tag.code);

			const action: FrameAction = {
				type: 'defineShape',
				data: { characterId, shape }
			};

			currentFrame.actions.push(action);
			displayList.addShape(characterId, shape);

			console.log(`DefineShape: id=${characterId}, bounds=`, shape.bounds);

		} catch (error) {
			console.warn(`Erro ao parsear shape ${characterId}:`, error);
		}
	}

	private processPlaceObject(tag: any, currentFrame: Frame) {
		const data = tag.data;
		let placeData: PlaceObjectData;

		try {
			if (tag.code === SwfTagCode.PlaceObject) {
				const characterId = data.readUint16();
				const depth = data.readUint16();
				const matrix = data.remaining > 0 ? data.readMatrix() : undefined;

				placeData = {
					characterId,
					depth,
					matrix,
					hasCharacter: true,
					hasMatrix: !!matrix
				};

			} else {
				// PlaceObject2/3
				const flags = data.readUint8();
				const depth = data.readUint16();

				placeData = {
					depth,
					hasClipActions: !!(flags & 0x80),
					hasClipDepth: !!(flags & 0x40),
					hasName: !!(flags & 0x20),
					hasRatio: !!(flags & 0x10),
					hasColorTransform: !!(flags & 0x08),
					hasMatrix: !!(flags & 0x04),
					hasCharacter: !!(flags & 0x02),
					hasMove: !!(flags & 0x01)
				};

				if (placeData.hasCharacter) {
					placeData.characterId = data.readUint16();
				}

				if (placeData.hasMatrix) {
					placeData.matrix = data.readMatrix();
				}

				if (placeData.hasColorTransform) {
					placeData.colorTransform = data.readColorTransform(tag.code === SwfTagCode.PlaceObject3);
				}

				if (placeData.hasRatio) {
					placeData.ratio = data.readUint16();
				}

				if (placeData.hasName) {
					placeData.name = data.readString();
				}

				if (placeData.hasClipDepth) {
					placeData.clipDepth = data.readUint16();
				}
			}

			const action: FrameAction = {
				type: 'placeObject',
				data: placeData
			};

			currentFrame.actions.push(action);

			console.log(`PlaceObject: characterId=${placeData.characterId}, depth=${placeData.depth}`);

		} catch (error) {
			console.warn('Erro ao processar PlaceObject:', error);
		}
	}

	private processRemoveObject(tag: any, currentFrame: Frame) {
		const data = tag.data;

		try {
			let depth: number;

			if (tag.code === SwfTagCode.RemoveObject) {
				data.readUint16(); // characterId
				depth = data.readUint16();
			} else {
				depth = data.readUint16();
			}

			const action: FrameAction = {
				type: 'removeObject',
				data: { depth }
			};

			currentFrame.actions.push(action);

			console.log(`RemoveObject: depth=${depth}`);

		} catch (error) {
			console.warn('Erro ao processar RemoveObject:', error);
		}
	}

	private processSetBackgroundColor(tag: any, currentFrame: Frame) {
		const data = tag.data;

		try {
			const r = data.readUint8() / 255;
			const g = data.readUint8() / 255;
			const b = data.readUint8() / 255;

			const action: FrameAction = {
				type: 'setBackgroundColor',
				data: { r, g, b, a: 1 }
			};

			currentFrame.actions.push(action);
			this.renderer.setBackgroundColor({ r, g, b, a: 1 });

			console.log(`SetBackgroundColor: rgb(${r}, ${g}, ${b})`);

		} catch (error) {
			console.warn('Erro ao processar SetBackgroundColor:', error);
		}
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

	private animate() {
		if (!this.isPlaying) return;

		this.animationId = requestAnimationFrame(() => this.animate());

		const currentTime = performance.now();
		const deltaTime = currentTime - this.lastFrameTime;
		const frameDuration = 1000 / this.frameRate;

		if (deltaTime >= frameDuration) {
			this.timeline.nextFrame();
			this.render();
			this.lastFrameTime = currentTime;
		}
	}

	private render() {
		const displayList = this.timeline.getDisplayList();
		const objects = displayList.getObjects();

		const renderObjects: RenderObject[] = objects
			.filter(obj => obj.visible && obj.shape)
			.map(obj => ({
				shape: obj.shape!,
				matrix: obj.matrix,
				colorTransform: obj.colorTransform,
				depth: obj.depth,
				characterId: obj.characterId
			}));

		this.renderer.render(renderObjects);
	}
}

