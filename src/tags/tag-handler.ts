import { SwfTagCode } from './tags';
import { Frame, DisplayList } from '../swf/display';

// Base interface for tag data
export interface TagData {
  code: SwfTagCode;
  data: any; // TODO: Replace with proper type once tag-specific data types are implemented
}

// Interface for tag handlers
export interface TagHandler {
  canHandle(tag: TagData): boolean;
  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;
}

// Registry for tag handlers
export class TagHandlerRegistry {
  private handlers: Map<SwfTagCode, TagHandler> = new Map();

  register(codes: SwfTagCode[], handler: TagHandler): void {
    for (const code of codes) {
      if (this.handlers.has(code)) {
        console.warn(`Handler for tag ${SwfTagCode[code]} already registered. Overwriting...`);
      }
      this.handlers.set(code, handler);
    }
  }

  getHandler(code: SwfTagCode): TagHandler | undefined {
    return this.handlers.get(code);
  }

  hasHandler(code: SwfTagCode): boolean {
    return this.handlers.has(code);
  }

  getRegisteredTags(): SwfTagCode[] {
    return Array.from(this.handlers.keys());
  }

  clearHandlers(): void {
    this.handlers.clear();
  }
}

// Base class for tag handlers
export abstract class BaseTagHandler implements TagHandler {
  abstract canHandle(tag: TagData): boolean;
  abstract handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;

  protected handleError(tag: TagData, error: Error): void {
    console.error(`Error processing tag ${SwfTagCode[tag.code]}: ${error.message}`);
    console.error(error);
  }
}

// Define handlers for each tag type
export class ShapeTagHandler extends BaseTagHandler {
  canHandle(tag: TagData): boolean {
    return [
      SwfTagCode.DefineShape,
      SwfTagCode.DefineShape2,
      SwfTagCode.DefineShape3,
      SwfTagCode.DefineShape4
    ].includes(tag.code);
  }

  handle(tag: TagData, frame: Frame, displayList: DisplayList) {
    try {
      const data = tag.data;
      const characterId = data.readUint16();
      const shape = parseShape(data, tag.code);

      frame.actions.push({
        type: 'defineShape',
        data: { characterId, shape }
      });

      displayList.addShape(characterId, shape);
    } catch (error) {
      this.handleError(tag, error as Error);
    }
  }
}

// TODO: Implement additional handlers for:
// - ActionScript/Button tags
// - Sound tags
// - Sprite tags
// - etc.
