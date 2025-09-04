import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';
import { Timeline } from '../../swf/display';
import { Matrix, ColorTransform } from '../../utils/bytes';

// Action types
interface ActionData {
    actions: Uint8Array;
    conditions?: number;
}

export class ActionScriptHandler extends BaseTagHandler {
    private actionScripts: Map<number, ActionData[]> = new Map();
    private frameScripts: Map<number, ActionData[]> = new Map();
    private timeline: Timeline | null = null;

    canHandle(tag: TagData): boolean {
        return [
            SwfTagCode.DoAction,
            SwfTagCode.DoInitAction,
            SwfTagCode.DefineButton,
            SwfTagCode.DefineButton2
        ].includes(tag.code);
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            switch (tag.code) {
                case SwfTagCode.DoAction:
                    await this.handleDoAction(tag, frame);
                    break;
                case SwfTagCode.DoInitAction:
                    await this.handleDoInitAction(tag, frame);
                    break;
            }
        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    private async handleDoAction(tag: TagData, frame: Frame): Promise<void> {
        const data = tag.data;
        const actions = new Uint8Array(data.remaining);
        for (let i = 0; i < data.remaining; i++) {
            actions[i] = data.readUint8();
        }

        frame.actions.push({
            type: 'doAction',
            data: { actions }
        });

        // Store frame script for execution
        const frameIndex = frame.actions.length - 1;
        const frameScripts = this.frameScripts.get(frameIndex) || [];
        frameScripts.push({ actions });
        this.frameScripts.set(frameIndex, frameScripts);
    }

    private async handleDoInitAction(tag: TagData, frame: Frame): Promise<void> {
        const data = tag.data;
        const spriteId = data.readUint16();
        const actions = new Uint8Array(data.remaining);
        for (let i = 0; i < data.remaining; i++) {
            actions[i] = data.readUint8();
        }

        frame.actions.push({
            type: 'doInitAction',
            data: { spriteId, actions }
        });

        // Store initialization script
        const initScripts = this.actionScripts.get(spriteId) || [];
        initScripts.push({ actions });
        this.actionScripts.set(spriteId, initScripts);
    }

    executeFrameScripts(frameIndex: number): void {
        const scripts = this.frameScripts.get(frameIndex);
        if (scripts) {
            for (const script of scripts) {
                this.executeActionScript(script.actions);
            }
        }
    }

    executeInitScripts(spriteId: number): void {
        const scripts = this.actionScripts.get(spriteId);
        if (scripts) {
            for (const script of scripts) {
                this.executeActionScript(script.actions);
            }
        }
    }

    private executeActionScript(actions: Uint8Array): void {
        // Basic ActionScript bytecode interpreter
        let ip = 0;
        while (ip < actions.length) {
            const actionCode = actions[ip++];
            switch (actionCode) {
                case 0x81: // GotoFrame
                    const frame = actions[ip++] | (actions[ip++] << 8);
                    this.gotoFrame(frame);
                    break;
                case 0x83: // GetURL
                    const urlLength = actions[ip++] | (actions[ip++] << 8);
                    const url = this.readString(actions, ip, urlLength);
                    ip += urlLength;
                    this.getURL(url);
                    break;
                case 0x8A: // WaitForFrame
                    const frameNum = actions[ip++] | (actions[ip++] << 8);
                    const skipCount = actions[ip++];
                    this.waitForFrame(frameNum, skipCount);
                    break;
                case 0x9F: // GotoFrame2
                    const flags = actions[ip++];
                    if (flags & 0x02) ip += 2; // Skip frame number
                    this.gotoFrame2(flags);
                    break;
                // Add more action codes as needed
            }
        }
    }

    private readString(actions: Uint8Array, offset: number, length: number): string {
        const bytes = actions.slice(offset, offset + length);
        return new TextDecoder().decode(bytes);
    }

    setTimeline(timeline: Timeline) {
        this.timeline = timeline;
    }

    private gotoFrame(frame: number): void {
        if (this.timeline) {
            this.timeline.gotoFrame(frame);
        }
    }

    private getURL(url: string): void {
        // Handle URL with proper security checks
        if (url.startsWith('javascript:')) {
            console.warn('JavaScript URLs are not allowed for security reasons');
            return;
        }

        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            console.error('Failed to open URL:', e);
        }
    }

    private waitForFrame(frame: number, skipCount: number): void {
        if (!this.timeline) return;

        const currentFrame = this.timeline.getCurrentFrame();
        if (currentFrame < frame) {
            // Skip the next skipCount actions
            return;
        }
    }

    private gotoFrame2(flags: number): void {
        if (!this.timeline) return;

        const play = !!(flags & 0x01);
        const scene = this.timeline.getCurrentFrame();

        if (play) {
            this.timeline.gotoFrame(scene);
            // TODO: Resume playback if play flag is set
        } else {
            this.timeline.gotoFrame(scene);
        }
    }
}
