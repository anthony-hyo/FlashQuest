import { SwfTagCode } from './tags';
import { Frame, DisplayList } from '../swf/display';
import { parseShape } from './handlers/shape-parser';

// TYPE SAFETY: Base interface lacks essential properties
// MISSING: Generic type parameter for specific tag data types
export interface TagData {
  code: SwfTagCode;
  data: any; // TYPE SAFETY: 'any' type loses critical type information for SWF data
  // MISSING: Should include length, version info, and validation status
  // MISSING: readonly properties to prevent mutation
  // MISSING: timestamp or processing metadata
}

// ARCHITECTURE: Interface could be more extensible
// MISSING: Lifecycle hooks (beforeHandle, afterHandle)
export interface TagHandler {
  canHandle(tag: TagData): boolean;
  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;
  // MISSING: cleanup() method for resource management
  // MISSING: priority() method for handler ordering
  // MISSING: validate() method for tag data validation
  // MISSING: supports() method for feature detection
}

// ARCHITECTURE: Registry pattern implementation has several issues
export class TagHandlerRegistry {
  // MEMORY LEAK: Map never cleaned up
  // TYPE SAFETY: Should use WeakMap or implement proper cleanup
  private handlers: Map<SwfTagCode, TagHandler> = new Map();

  // MISSING: Input validation for parameters
  // ARCHITECTURE: Should support handler priorities or chaining
  register(codes: SwfTagCode[], handler: TagHandler): void {
    // TYPE SAFETY: codes array could be empty, should validate
    for (const code of codes) {
      if (this.handlers.has(code)) {
        // BUG: Warning but continues - could cause unexpected behavior
        // ISSUE: Should provide option to prevent overwriting
        console.warn(`Handler for tag ${SwfTagCode[code]} already registered. Overwriting...`);
      }
      this.handlers.set(code, handler);
    }
    // MISSING: Validation that handler actually implements required methods
    // MISSING: Registration metadata (timestamp, source, etc.)
  }

  // PERFORMANCE: Direct map lookup is efficient
  getHandler(code: SwfTagCode): TagHandler | undefined {
    return this.handlers.get(code);
    // MISSING: Fallback handler mechanism
    // MISSING: Handler composition support
  }

  // ARCHITECTURE: Simple boolean check, could be enhanced
  hasHandler(code: SwfTagCode): boolean {
    return this.handlers.has(code);
  }

  // PERFORMANCE: Creates new array every call - should cache
  // MISSING: Optional filtering by handler type or capabilities
  getRegisteredTags(): SwfTagCode[] {
    return Array.from(this.handlers.keys());
  }

  // ARCHITECTURE: Basic cleanup but incomplete
  clearHandlers(): void {
    this.handlers.clear();
    // MISSING: Should call cleanup on handlers if they support it
    // MEMORY LEAK: Handlers might hold references to resources
  }
}

// ARCHITECTURE: Base class provides minimal functionality
// MISSING: Common utilities that most handlers would need
export abstract class BaseTagHandler implements TagHandler {
  abstract canHandle(tag: TagData): boolean;
  abstract handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void>;

  // ERROR HANDLING: Basic error handling but lacks robustness
  protected handleError(tag: TagData, error: Error): void {
    // LOGGING ISSUE: Error details lost in production - should use proper error logging
    // MISSING: Error categorization (recoverable vs fatal)
    console.error(`Error processing tag ${SwfTagCode[tag.code]}: ${error.message}`);
    console.error(error);
    // MISSING: Error recovery strategies
    // MISSING: Error reporting to external systems
    // MISSING: Metrics collection for error patterns
  }
}

// IMPLEMENTATION: Specific handler with several issues
export class ShapeTagHandler extends BaseTagHandler {
  // TYPE SAFETY: Could use more specific typing for tag codes
  canHandle(tag: TagData): boolean {
    return [
      SwfTagCode.DefineShape,
      SwfTagCode.DefineShape2,
      SwfTagCode.DefineShape3,
      SwfTagCode.DefineShape4
    ].includes(tag.code);
  }

  // ASYNC HANDLING: Unnecessarily complex async pattern
  // ERROR HANDLING: Inconsistent error handling approach
  handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
    try {
      const data = tag.data;
      // MISSING: Data validation before reading
      // TYPE SAFETY: data type is 'any', no compile-time safety
      const characterId = data.readUint16();
      const shape = parseShape(data, tag.code);

      // ARCHITECTURE: Direct mutation of frame actions
      // MISSING: Validation of characterId uniqueness
      frame.actions.push({
        type: 'defineShape',
        data: { characterId, shape }
      });

      // ARCHITECTURE: Direct mutation of display list
      // MISSING: Error handling if addShape fails
      displayList.addShape(characterId, shape);
      return Promise.resolve(); // REDUNDANT: Could just return resolved promise directly
    } catch (error) {
      this.handleError(tag, error as Error);
      return Promise.reject(error); // BUG: Rejecting after logging - error handled twice
    }
  }
}

// MISSING IMPLEMENTATIONS: Critical handlers not implemented
// TODO: Implement additional handlers for:
// - ActionScript/Button tags
// - Sound tags  
// - Sprite tags
// - etc.
