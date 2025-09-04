import { Frame, DisplayList } from '../../swf/display';

interface ActionContext {
    variables: Map<string, any>;
    functions: Map<string, Function>;
    scope: any[];
}

export class ActionScriptVM {
    private stack: any[] = [];
    private context: ActionContext = {
        variables: new Map(),
        functions: new Map(),
        scope: []
    };
    private constants: Map<number, string> = new Map();

    executeActions(actions: Uint8Array): void {
        let ip = 0;
        while (ip < actions.length) {
            const actionCode = actions[ip++];
            
            switch (actionCode) {
                // Stack operations
                case 0x96: // Push
                    ip = this.handlePush(actions, ip);
                    break;
                case 0x17: // Pop
                    this.stack.pop();
                    break;

                // Variables and properties
                case 0x1C: // GetVariable
                    this.handleGetVariable();
                    break;
                case 0x1D: // SetVariable
                    this.handleSetVariable();
                    break;

                // Movie control
                case 0x81: // GotoFrame
                    ip = this.handleGotoFrame(actions, ip);
                    break;
                case 0x83: // GetURL
                    ip = this.handleGetURL(actions, ip);
                    break;
                case 0x8A: // WaitForFrame
                    ip = this.handleWaitForFrame(actions, ip);
                    break;

                // Functions and methods
                case 0x9B: // DefineFunction
                    ip = this.handleDefineFunction(actions, ip);
                    break;
                case 0x3D: // CallFunction
                    this.handleCallFunction();
                    break;

                // Conditions and branching
                case 0x9D: // If
                    ip = this.handleIf(actions, ip);
                    break;
                case 0x99: // Jump
                    ip = this.handleJump(actions, ip);
                    break;

                // Arithmetic and logic
                case 0x0A: // Add
                    this.handleAdd();
                    break;
                case 0x0B: // Subtract
                    this.handleSubtract();
                    break;
                case 0x0C: // Multiply
                    this.handleMultiply();
                    break;
                case 0x0D: // Divide
                    this.handleDivide();
                    break;

                // Comparison
                case 0x0E: // Equals
                    this.handleEquals();
                    break;
                case 0x0F: // Less
                    this.handleLess();
                    break;
                case 0x10: // Greater
                    this.handleGreater();
                    break;

                // String manipulation
                case 0x21: // StringAdd
                    this.handleStringAdd();
                    break;
                case 0x29: // StringLength
                    this.handleStringLength();
                    break;

                // Type conversion
                case 0x18: // ToInteger
                    this.handleToInteger();
                    break;
                case 0x33: // ToString
                    this.handleToString();
                    break;

                // Movie clip control
                case 0x8B: // GotoLabel
                    ip = this.handleGotoLabel(actions, ip);
                    break;
                case 0x9F: // GotoFrame2
                    ip = this.handleGotoFrame2(actions, ip);
                    break;
            }
        }
    }

    private handlePush(actions: Uint8Array, ip: number): number {
        const type = actions[ip++];
        switch (type) {
            case 0: // String
                const str = this.readString(actions, ip);
                this.stack.push(str);
                ip += str.length + 1;
                break;
            case 1: // Float
                this.stack.push(this.readFloat(actions, ip));
                ip += 4;
                break;
            case 2: // null
                this.stack.push(null);
                break;
            case 3: // undefined
                this.stack.push(undefined);
                break;
            case 4: // Register
                const reg = actions[ip++];
                this.stack.push(this.context.variables.get(reg));
                break;
            case 5: // Boolean
                this.stack.push(actions[ip++] !== 0);
                break;
            case 6: // Double
                this.stack.push(this.readDouble(actions, ip));
                ip += 8;
                break;
            case 7: // Integer
                this.stack.push(this.readInt32(actions, ip));
                ip += 4;
                break;
            case 8: // Constant8
                this.stack.push(this.constants.get(actions[ip++]));
                break;
            case 9: // Constant16
                this.stack.push(this.constants.get(this.readUint16(actions, ip)));
                ip += 2;
                break;
        }
        return ip;
    }

    private handleGetVariable(): void {
        const name = this.stack.pop();
        this.stack.push(this.context.variables.get(name));
    }

    private handleSetVariable(): void {
        const value = this.stack.pop();
        const name = this.stack.pop();
        this.context.variables.set(name, value);
    }

    private handleDefineFunction(actions: Uint8Array, ip: number): number {
        const nameLen = this.readUint16(actions, ip);
        ip += 2;
        const name = this.readString(actions, ip);
        ip += nameLen;

        const numParams = this.readUint16(actions, ip);
        ip += 2;

        const params: string[] = [];
        for (let i = 0; i < numParams; i++) {
            const paramLen = this.readUint16(actions, ip);
            ip += 2;
            params.push(this.readString(actions, ip));
            ip += paramLen;
        }

        const codeSize = this.readUint16(actions, ip);
        ip += 2;

        const code = actions.slice(ip, ip + codeSize);
        ip += codeSize;

        const fn = (...args: any[]) => {
            // Create new scope
            const oldScope = this.context.scope;
            this.context.scope = [...oldScope];

            // Set parameters
            for (let i = 0; i < params.length; i++) {
                this.context.variables.set(params[i], args[i]);
            }

            // Execute function code
            this.executeActions(code);

            // Restore scope
            this.context.scope = oldScope;

            // Return top of stack
            return this.stack.pop();
        };

        if (name) {
            this.context.functions.set(name, fn);
        }
        this.stack.push(fn);

        return ip;
    }

    private handleCallFunction(): void {
        const name = this.stack.pop();
        const numArgs = this.stack.pop();
        const args = [];
        for (let i = 0; i < numArgs; i++) {
            args.unshift(this.stack.pop());
        }
        const fn = this.context.functions.get(name);
        if (fn) {
            const result = fn(...args);
            this.stack.push(result);
        }
    }

    // Helper methods for reading data types
    private readString(actions: Uint8Array, offset: number): string {
        let str = '';
        while (actions[offset] !== 0) {
            str += String.fromCharCode(actions[offset++]);
        }
        return str;
    }

    private readUint16(actions: Uint8Array, offset: number): number {
        return actions[offset] | (actions[offset + 1] << 8);
    }

    private readInt32(actions: Uint8Array, offset: number): number {
        return actions[offset] | (actions[offset + 1] << 8) |
               (actions[offset + 2] << 16) | (actions[offset + 3] << 24);
    }

    private readFloat(actions: Uint8Array, offset: number): number {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        for (let i = 0; i < 4; i++) {
            view.setUint8(i, actions[offset + i]);
        }
        return view.getFloat32(0);
    }

    private readDouble(actions: Uint8Array, offset: number): number {
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        for (let i = 0; i < 8; i++) {
            view.setUint8(i, actions[offset + i]);
        }
        return view.getFloat64(0);
    }

    // Arithmetic handlers
    private handleAdd(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a + b);
    }

    private handleSubtract(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a - b);
    }

    private handleMultiply(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a * b);
    }

    private handleDivide(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a / b);
    }

    // Comparison handlers
    private handleEquals(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a === b);
    }

    private handleLess(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a < b);
    }

    private handleGreater(): void {
        const b = this.stack.pop();
        const a = this.stack.pop();
        this.stack.push(a > b);
    }

    // String handlers
    private handleStringAdd(): void {
        const b = String(this.stack.pop());
        const a = String(this.stack.pop());
        this.stack.push(a + b);
    }

    private handleStringLength(): void {
        const str = String(this.stack.pop());
        this.stack.push(str.length);
    }

    // Type conversion handlers
    private handleToInteger(): void {
        this.stack.push(parseInt(String(this.stack.pop()), 10));
    }

    private handleToString(): void {
        this.stack.push(String(this.stack.pop()));
    }

    // Navigation handlers
    private handleGotoFrame(actions: Uint8Array, ip: number): number {
        const frame = this.readUint16(actions, ip);
        // Emit frame navigation event
        this.emit('gotoFrame', frame);
        return ip + 2;
    }

    private handleGotoLabel(actions: Uint8Array, ip: number): number {
        const label = this.readString(actions, ip);
        // Emit label navigation event
        this.emit('gotoLabel', label);
        return ip + label.length + 1;
    }

    private handleGotoFrame2(actions: Uint8Array, ip: number): number {
        const flags = actions[ip++];
        const play = !!(flags & 0x01);
        const frame = this.stack.pop();
        // Emit frame navigation event
        this.emit('gotoFrame2', { frame, play });
        return ip;
    }

    private handleIf(actions: Uint8Array, ip: number): number {
        const offset = this.readInt16(actions, ip);
        if (!this.stack.pop()) {
            ip += offset;
        }
        return ip + 2;
    }

    private handleJump(actions: Uint8Array, ip: number): number {
        const offset = this.readInt16(actions, ip);
        return ip + offset;
    }

    private handleGetURL(actions: Uint8Array, ip: number): number {
        const urlLen = this.readUint16(actions, ip);
        ip += 2;
        const url = this.readString(actions, ip);
        ip += urlLen;

        const targetLen = this.readUint16(actions, ip);
        ip += 2;
        const target = this.readString(actions, ip);
        ip += targetLen;

        // Emit URL navigation event
        this.emit('getURL', { url, target });
        
        return ip;
    }

    private handleWaitForFrame(actions: Uint8Array, ip: number): number {
        const frame = this.readUint16(actions, ip);
        ip += 2;
        const skipCount = actions[ip++];

        // Emit wait event
        this.emit('waitForFrame', { frame, skipCount });

        return ip;
    }

    // Add helper method for reading signed 16-bit integers
    private readInt16(actions: Uint8Array, offset: number): number {
        let value = this.readUint16(actions, offset);
        if (value & 0x8000) {
            value = -(~value & 0xFFFF) - 1;
        }
        return value;
    }
    
    // Event system
    private listeners: Map<string, Function[]> = new Map();

    private emit(event: string, data: any): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.forEach(handler => handler(data));
        }
    }

    on(event: string, handler: Function): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(handler);
    }

    off(event: string, handler: Function): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index !== -1) {
                handlers.splice(index, 1);
            }
        }
    }
}
