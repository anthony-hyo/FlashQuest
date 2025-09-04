import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList, Timeline } from '../../swf/display';
import { Matrix, ColorTransform } from '../../utils/bytes';

export interface SpriteData {
    characterId: number;
    frameCount: number;
    timeline: Timeline;
    bounds?: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
    };
}

export interface SpriteCache {
    displayList: DisplayList;
    timestamp: number;
}

export class SpriteHandler extends BaseTagHandler {
    private sprites: Map<number, SpriteData> = new Map();
    private spriteCache: Map<number, SpriteCache> = new Map();
    private readonly CACHE_LIFETIME = 5000; // Cache for 5 seconds

    canHandle(tag: TagData): boolean {
        return tag.code === SwfTagCode.DefineSprite;
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            const data = tag.data;
            const characterId = data.readUint16();
            const frameCount = data.readUint16();

            const timeline = new Timeline();
            let currentFrame: Frame = { actions: [] };

            while (data.remaining > 0) {
                const tagInfo = this.readTagHeader(data);
                if (!tagInfo) break;

                const { code, length } = tagInfo;
                const tagData = data.readBytes(length);

                if (code === SwfTagCode.ShowFrame) {
                    timeline.addFrame(currentFrame);
                    currentFrame = { actions: [] };
                } else if (code === SwfTagCode.End) {
                    if (currentFrame.actions.length > 0) {
                        timeline.addFrame(currentFrame);
                    }
                    break;
                } else {
                    await this.processSpriteSubTag(code, tagData, currentFrame);
                }
            }

            // Register sprite with bounds calculation
            const spriteData: SpriteData = {
                characterId,
                frameCount,
                timeline,
                bounds: this.calculateSpriteBounds(timeline)
            };
            this.sprites.set(characterId, spriteData);

            // Add sprite definition to frame
            frame.actions.push({
                type: 'defineSprite',
                data: spriteData
            });

        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    private readTagHeader(data: any): { code: number; length: number } | null {
        if (data.remaining < 2) return null;

        const typeAndLength = data.readUint16();
        const code = typeAndLength >> 6;
        let length = typeAndLength & 0x3F;

        if (length === 0x3F) {
            if (data.remaining < 4) return null;
            length = data.readUint32();
        }

        if (length > data.remaining) return null;
        return { code, length };
    }

    private async processSpriteSubTag(code: number, data: any, frame: Frame): Promise<void> {
        switch (code) {
            case SwfTagCode.PlaceObject:
            case SwfTagCode.PlaceObject2:
            case SwfTagCode.PlaceObject3:
                this.handlePlaceObject(code, data, frame);
                break;
            case SwfTagCode.RemoveObject:
            case SwfTagCode.RemoveObject2:
                this.handleRemoveObject(code, data, frame);
                break;
        }
    }

    private handlePlaceObject(code: number, data: any, frame: Frame): void {
        let placeData: any;

        if (code === SwfTagCode.PlaceObject) {
            placeData = {
                characterId: data.readUint16(),
                depth: data.readUint16(),
                matrix: data.readMatrix(),
                colorTransform: data.remaining > 0 ? data.readColorTransform(false) : undefined,
                hasCharacter: true,
                hasMatrix: true
            };
        } else {
            const flags = data.readUint8();
            const hasClipActions = !!(flags & 0x80);
            const hasClipDepth = !!(flags & 0x40);
            const hasName = !!(flags & 0x20);
            const hasRatio = !!(flags & 0x10);
            const hasColorTransform = !!(flags & 0x08);
            const hasMatrix = !!(flags & 0x04);
            const hasCharacter = !!(flags & 0x02);
            const hasMove = !!(flags & 0x01);

            if (code === SwfTagCode.PlaceObject3) {
                const flags2 = data.readUint8();
                const hasImage = !!(flags2 & 0x10);
                const hasClassName = !!(flags2 & 0x08);
                const hasCacheAsBitmap = !!(flags2 & 0x04);
                const hasBlendMode = !!(flags2 & 0x02);
                const hasFilterList = !!(flags2 & 0x01);

                placeData = {
                    blendMode: hasBlendMode ? data.readUint8() : undefined,
                    cacheAsBitmap: hasCacheAsBitmap
                };
            }

            const depth = data.readUint16();
            placeData = { ...placeData, depth };

            if (hasCharacter) {
                placeData.characterId = data.readUint16();
            }
            if (hasMatrix) {
                placeData.matrix = data.readMatrix();
            }
            if (hasColorTransform) {
                placeData.colorTransform = data.readColorTransform(code === SwfTagCode.PlaceObject3);
            }
            if (hasClipDepth) {
                placeData.clipDepth = data.readUint16();
            }

            placeData.hasCharacter = hasCharacter;
            placeData.hasMatrix = hasMatrix;
            placeData.hasColorTransform = hasColorTransform;
            placeData.hasMove = hasMove;
        }

        frame.actions.push({
            type: 'placeObject',
            data: placeData
        });
    }

    private handleRemoveObject(code: number, data: any, frame: Frame): void {
        const removeData = code === SwfTagCode.RemoveObject
            ? { characterId: data.readUint16(), depth: data.readUint16() }
            : { depth: data.readUint16() };

        frame.actions.push({
            type: 'removeObject',
            data: removeData
        });
    }

    private calculateSpriteBounds(timeline: Timeline): { xMin: number; xMax: number; yMin: number; yMax: number } {
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        
        for (let i = 0; i < timeline.getTotalFrames(); i++) {
            const objects = timeline.getDisplayList().getObjects();
            for (const obj of objects) {
                if (obj.bounds) {
                    xMin = Math.min(xMin, obj.bounds.xMin);
                    xMax = Math.max(xMax, obj.bounds.xMax);
                    yMin = Math.min(yMin, obj.bounds.yMin);
                    yMax = Math.max(yMax, obj.bounds.yMax);
                }
            }
            timeline.nextFrame();
        }
        
        return { xMin, xMax, yMin, yMax };
    }

    getSprite(characterId: number): SpriteData | undefined {
        const sprite = this.sprites.get(characterId);
        if (sprite) {
            // Update cache if needed
            const cache = this.spriteCache.get(characterId);
            const now = Date.now();
            if (!cache || now - cache.timestamp > this.CACHE_LIFETIME) {
                const displayList = new DisplayList();
                sprite.timeline.gotoFrame(0);
                // Pre-process all frames for this sprite
                for (let i = 0; i < sprite.frameCount; i++) {
                    sprite.timeline.nextFrame();
                }
                this.spriteCache.set(characterId, {
                    displayList: displayList,
                    timestamp: now
                });
            }
        }
        return sprite;
    }

    clearCache(): void {
        this.spriteCache.clear();
    }

    cleanupOldCache(): void {
        const now = Date.now();
        for (const [id, cache] of this.spriteCache.entries()) {
            if (now - cache.timestamp > this.CACHE_LIFETIME) {
                this.spriteCache.delete(id);
            }
        }
    }
}
