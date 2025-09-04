import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';

export class ButtonTagHandler extends BaseTagHandler {
    private buttonStates: Map<number, any> = new Map();

    canHandle(tag: TagData): boolean {
        return [
            SwfTagCode.DefineButton,
            SwfTagCode.DefineButton2
        ].includes(tag.code);
    }

    handle(tag: TagData, frame: Frame, displayList: DisplayList): void {
        try {
            const data = tag.data;
            const buttonId = data.readUint16();
            const buttonData = this.parseButtonData(tag);

            frame.actions.push({
                type: 'defineButton',
                data: { 
                    characterId: buttonId, 
                    button: buttonData 
                }
            });

            // Store button state for interactivity
            this.buttonStates.set(buttonId, {
                up: buttonData.up,
                over: buttonData.over,
                down: buttonData.down,
                hit: buttonData.hit,
                actions: buttonData.actions
            });

        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    private parseButtonData(tag: TagData) {
        const data = tag.data;
        const isButton2 = tag.code === SwfTagCode.DefineButton2;
        
        // Parse button records for each state
        const states = {
            up: [],
            over: [],
            down: [],
            hit: []
        };

        // Parse button actions
        const actions = isButton2 ? this.parseButton2Actions(data) : this.parseButtonActions(data);

        return {
            ...states,
            actions
        };
    }

    private parseButtonActions(data: any) {
        // Parse DefineButton actions
        const actions = [];
        while (data.remaining > 0) {
            const condition = data.readUint16();
            const size = data.readUint16();
            const actionData = data.readBytes(size);
            actions.push({ condition, data: actionData });
        }
        return actions;
    }

    private parseButton2Actions(data: any) {
        // Parse DefineButton2 actions with extended features
        const actions = [];
        const buttonSize = data.readUint16();
        const buttonFlags = data.readUint8();
        
        while (data.remaining > 0) {
            const condition = data.readUint16();
            const size = data.readUint16();
            const actionData = data.readBytes(size);
            actions.push({ 
                condition,
                data: actionData,
                flags: buttonFlags
            });
        }
        return actions;
    }
}
