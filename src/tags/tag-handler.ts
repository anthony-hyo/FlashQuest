import { SwfTagCode } from './tags';
import { Frame, DisplayList } from '../swf/display';
import { parseShape } from './handlers/shape-parser';

// Base interface for tag data
export interface TagData {
  code: SwfTagCode;
  data: any; // TYPE SAFETY: 'any' type loses critical type information for SWF data
  // MISSING: Should include length, version info, and validation status
}

// Interface for tag handlers
export interface TagHandler {
  canHandle(tag: TagData): boolean;
  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;
  // MISSING: cleanup() method for resource management
  // MISSING: priority() method for handler ordering
}

// Registry for tag handlers
export class TagHandlerRegistry {
  private handlers: Map<SwfTagCode, TagHandler> = new Map(); // MEMORY LEAK: Map never cleaned up

  register(codes: SwfTagCode[], handler: TagHandler): void {
    for (const code of codes) {
      if (this.handlers.has(code)) {
        // BUG: Warning but continues - could cause unexpected behavior
        console.warn(`Handler for tag ${SwfTagCode[code]} already registered. Overwriting...`);
      }
      this.handlers.set(code, handler);
    }
    // MISSING: Validation that handler actually implements required methods
  }

  getHandler(code: SwfTagCode): TagHandler | undefined {
    return this.handlers.get(code);
    // PERFORMANCE: Linear search for complex handler hierarchies would be better
  }

  hasHandler(code: SwfTagCode): boolean {
    return this.handlers.has(code);
  }

  getRegisteredTags(): SwfTagCode[] {
    // PERFORMANCE: Creates new array every call - should cache
    return Array.from(this.handlers.keys());
  }

  clearHandlers(): void {
    this.handlers.clear();
    // MISSING: Should call cleanup on handlers if they support it
  }
}

// Base class for tag handlers
export abstract class BaseTagHandler implements TagHandler {
  abstract canHandle(tag: TagData): boolean;
  abstract handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;

  protected handleError(tag: TagData, error: Error): void {
    // LOGGING ISSUE: Error details lost in production - should use proper error logging
    console.error(`Error processing tag ${SwfTagCode[tag.code]}: ${error.message}`);
    console.error(error);
    // MISSING: Error recovery strategies
    // MISSING: Error reporting to external systems
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

  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
    try {
      const data = tag.data;
      // MISSING: Data validation before reading
      const characterId = data.readUint16();
      const shape = parseShape(data, tag.code);

      frame.actions.push({
        type: 'defineShape',
        data: { characterId, shape }
      });

      displayList.addShape(characterId, shape);
      return Promise.resolve(); // REDUNDANT: Could just return resolved promise directly
    } catch (error) {
      this.handleError(tag, error as Error);
      return Promise.reject(error); // BUG: Rejecting after logging - error handled twice
    }
  }
}

// TODO: Implement additional handlers for:
// - ActionScript/Button tags
// - Sound tags
// - Sprite tags
// - etc.
