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

			// Log all tag types found
			const tagTypes = tags.map(tag => ({ code: tag.code, name: this.getTagName(tag.code) }));
			console.log('Tags encontradas:', tagTypes);

			// Processar tags e construir timeline
			this.buildTimeline(tags);

			// If no frames were created, create a test frame
			if (this.timeline.getTotalFrames() === 0) {
				console.warn('No frames found in SWF, creating test content');
				this.createTestContent();
			}

			// Renderizar primeiro frame
			this.timeline.gotoFrame(0);
			this.render();

			console.log('SWF carregado com sucesso!');

		} catch (error) {
			console.error('Erro ao carregar SWF:', error);
			throw error;
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

		// Create a frame with the test shape
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
							scaleX: 1,
							scaleY: 1,
							rotateSkew0: 0,
							rotateSkew1: 0,
							translateX: 2000, // Center horizontally (100px from left)
							translateY: 2000  // Center vertically (100px from top)
						}
					}
				}
			]
		};

		this.timeline.addFrame(frame);
		console.log('Test content created');
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

					case SwfTagCode.DefineBits:
					case SwfTagCode.DefineBitsJPEG2:
					case SwfTagCode.DefineBitsJPEG3:
					case SwfTagCode.DefineBitsLossless:
					case SwfTagCode.DefineBitsLossless2:
						this.processDefineBits(tag, currentFrame);
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

	private processDefineBits(tag: any, currentFrame: Frame) {
		const data = tag.data;
		let bitmapData: any;

		try {
			if (tag.code === SwfTagCode.DefineBits) {
				const characterId = data.readUint16();
				const bitmapFormat = data.readUint8();
				const bitmapWidth = data.readUint16();
				const bitmapHeight = data.readUint16();
				const colorTableSize = data.readUint8();
				const transparentColorIndex = data.readUint8();
				const hasAlpha = (bitmapFormat & 0x20) !== 0;

				bitmapData = {
					characterId,
					bitmapFormat,
					bitmapWidth,
					bitmapHeight,
					colorTableSize,
					transparentColorIndex,
					hasAlpha
				};

				if (hasAlpha) {
					// Alpha bitmap
					data.readUint8(); // Skip reserved byte
					bitmapData.alphaData = data.readBytes(bitmapWidth * bitmapHeight);
				} else {
					// Non-alpha bitmap
					bitmapData.colorData = data.readBytes(bitmapWidth * bitmapHeight);
				}

			} else {
				// JPEG or Lossless bitmap
				const characterId = data.readUint16();
				const bitmapDataLength = data.readUint32();
				const bitmapDataStart = data.position;

				bitmapData = {
					characterId,
					bitmapDataLength,
					bitmapDataStart
				};

				data.position += bitmapDataLength; // Skip bitmap data
			}

			const action: FrameAction = {
				type: 'defineBits',
				data: bitmapData
			};

			currentFrame.actions.push(action);

			console.log(`DefineBits: characterId=${bitmapData.characterId}, format=${bitmapData.bitmapFormat}, size=${bitmapData.bitmapWidth}x${bitmapData.bitmapHeight}`);

		} catch (error) {
			console.warn('Erro ao processar DefineBits:', error);
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

	// Test method to verify renderer works without SWF
	testRenderer() {
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
		console.log('Testing direct WebGL rendering...');
		
		// Create simple triangle vertices
		const vertices = [
			100, 100,  // Top
			50, 200,   // Bottom left
			150, 200   // Bottom right
		];
		
		const colors = [
			1, 0, 0, 1,  // Red
			0, 1, 0, 1,  // Green
			0, 0, 1, 1   // Blue
		];
		
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

		console.log(`Rendering frame ${this.timeline.getCurrentFrame()}: ${objects.length} objects`);
		
		if (objects.length === 0) {
			console.warn('No objects to render');
			// Clear canvas with background color
			this.renderer.render([]);
			return;
		}

		const renderObjects: RenderObject[] = objects
			.filter(obj => {
				if (!obj.visible) {
					console.log(`Object at depth ${obj.depth} is not visible`);
					return false;
				}
				if (!obj.shape) {
					console.log(`Object at depth ${obj.depth} has no shape`);
					return false;
				}
				return true;
			})
			.map(obj => {
				console.log(`Rendering object: depth=${obj.depth}, characterId=${obj.characterId}, shape records=${obj.shape?.records?.length || 0}`);
				return {
					shape: obj.shape!,
					matrix: obj.matrix,
					colorTransform: obj.colorTransform,
					depth: obj.depth,
					characterId: obj.characterId
				};
			});

		console.log(`Final render objects: ${renderObjects.length}`);
		this.renderer.render(renderObjects);
	}
}
