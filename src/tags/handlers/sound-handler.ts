import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';

export interface SoundInfo {
    format: number;
    rate: number;
    size: number;
    type: number;
    sampleCount: number;
    data: ArrayBuffer;
}

export class SoundHandler extends BaseTagHandler {
    private audioContext: AudioContext;
    private sounds: Map<number, AudioBuffer> = new Map();
    private activeNodes: Map<number, AudioBufferSourceNode> = new Map();

    constructor() {
        super();
        this.audioContext = new AudioContext();
    }

    canHandle(tag: TagData): boolean {
        return [
            SwfTagCode.DefineSound,
            SwfTagCode.StartSound,
            SwfTagCode.StartSound2,
            SwfTagCode.SoundStreamHead,
            SwfTagCode.SoundStreamHead2,
            SwfTagCode.SoundStreamBlock
        ].includes(tag.code);
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            switch (tag.code) {
                case SwfTagCode.DefineSound:
                    await this.handleDefineSound(tag, frame);
                    break;
                case SwfTagCode.StartSound:
                case SwfTagCode.StartSound2:
                    this.handleStartSound(tag, frame);
                    break;
                case SwfTagCode.SoundStreamHead:
                case SwfTagCode.SoundStreamHead2:
                    this.handleSoundStreamHead(tag, frame);
                    break;
                case SwfTagCode.SoundStreamBlock:
                    await this.handleSoundStreamBlock(tag, frame);
                    break;
            }
        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    private async handleDefineSound(tag: TagData, frame: Frame): Promise<void> {
        const data = tag.data;
        const soundId = data.readUint16();
        const formatInfo = data.readUint8();
        const format = (formatInfo >> 4) & 0x0F;
        const rate = (formatInfo >> 2) & 0x03;
        const size = (formatInfo >> 1) & 0x01;
        const type = formatInfo & 0x01;
        const sampleCount = data.readUint32();

        // Read sound data
        const soundData = new Uint8Array(data.remaining);
        for (let i = 0; i < data.remaining; i++) {
            soundData[i] = data.readUint8();
        }

        // Create audio buffer from sound data
        const audioBuffer = await this.createAudioBuffer(soundData, format);
        if (audioBuffer) {
            this.sounds.set(soundId, audioBuffer);
        }

        frame.actions.push({
            type: 'defineSound',
            data: {
                soundId,
                format,
                rate,
                size,
                type,
                sampleCount
            }
        });
    }

    private handleStartSound(tag: TagData, frame: Frame): void {
        const data = tag.data;
        const soundId = data.readUint16();
        const soundInfo = this.parseSoundInfo(data);

        frame.actions.push({
            type: 'startSound',
            data: { soundId, soundInfo }
        });

        // Start playing the sound if it exists
        const audioBuffer = this.sounds.get(soundId);
        if (audioBuffer) {
            this.playSound(soundId, audioBuffer, soundInfo);
        }
    }

    private handleSoundStreamHead(tag: TagData, frame: Frame): void {
        const data = tag.data;
        const mixFormat = data.readUint8();
        const playbackRate = (mixFormat >> 2) & 0x03;
        const playbackSize = (mixFormat >> 1) & 0x01;
        const playbackType = mixFormat & 0x01;

        const streamFormat = data.readUint8();
        const streamRate = (streamFormat >> 2) & 0x03;
        const streamSize = (streamFormat >> 1) & 0x01;
        const streamType = streamFormat & 0x01;

        const sampleCount = data.readUint16();
        const latencySeek = streamFormat === 2 ? data.readInt16() : 0;

        frame.actions.push({
            type: 'soundStreamHead',
            data: {
                playbackRate,
                playbackSize,
                playbackType,
                streamRate,
                streamSize,
                streamType,
                sampleCount,
                latencySeek
            }
        });
    }

    private async handleSoundStreamBlock(tag: TagData, frame: Frame): Promise<void> {
        const data = tag.data;
        const soundData = new Uint8Array(data.remaining);
        for (let i = 0; i < data.remaining; i++) {
            soundData[i] = data.readUint8();
        }

        frame.actions.push({
            type: 'soundStreamBlock',
            data: { soundData }
        });
    }

    private parseSoundInfo(data: any): any {
        const flags = data.readUint8();
        return {
            syncStop: (flags & 0x20) !== 0,
            syncNoMultiple: (flags & 0x10) !== 0,
            hasInPoint: (flags & 0x08) !== 0,
            hasOutPoint: (flags & 0x04) !== 0,
            hasLoops: (flags & 0x02) !== 0,
            hasEnvelope: (flags & 0x01) !== 0,
            inPoint: (flags & 0x08) ? data.readUint32() : undefined,
            outPoint: (flags & 0x04) ? data.readUint32() : undefined,
            loopCount: (flags & 0x02) ? data.readUint16() : 1,
            envelope: (flags & 0x01) ? this.parseSoundEnvelope(data) : undefined
        };
    }

    private parseSoundEnvelope(data: any): any[] {
        const points = data.readUint8();
        const envelope = [];
        for (let i = 0; i < points; i++) {
            envelope.push({
                position: data.readUint32(),
                leftLevel: data.readUint16(),
                rightLevel: data.readUint16()
            });
        }
        return envelope;
    }

    private async createAudioBuffer(data: Uint8Array, format: number): Promise<AudioBuffer | null> {
        try {
            // For now, we only handle uncompressed PCM
            // TODO: Add support for MP3, ADPCM formats
            if (format === 0) { // PCM
                // Create a new ArrayBuffer with the contents of data to ensure it's not a SharedArrayBuffer
                const arrayBuffer = new ArrayBuffer(data.byteLength);
                new Uint8Array(arrayBuffer).set(data);
                return await this.audioContext.decodeAudioData(arrayBuffer);
            }
            console.warn('Unsupported audio format:', format);
            return null;
        } catch (error) {
            console.error('Error creating audio buffer:', error);
            return null;
        }
    }

    private playSound(soundId: number, buffer: AudioBuffer, info: any): void {
        // Stop any existing playback of this sound
        this.stopSound(soundId);

        // Create and configure source node
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        if (info.hasLoops) {
            source.loop = true;
            source.loopStart = info.inPoint || 0;
            source.loopEnd = info.outPoint || buffer.duration;
        }

        // Apply envelope if present
        if (info.hasEnvelope && info.envelope) {
            const gainNode = this.audioContext.createGain();
            this.applyEnvelope(gainNode, info.envelope);
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
        } else {
            source.connect(this.audioContext.destination);
        }

        // Start playback
        const startTime = this.audioContext.currentTime;
        const offset = info.inPoint || 0;
        const duration = info.hasOutPoint ? (info.outPoint - offset) : undefined;
        source.start(startTime, offset, duration);

        // Store the source node for later cleanup
        this.activeNodes.set(soundId, source);

        // Remove from active nodes when playback ends
        source.onended = () => {
            this.activeNodes.delete(soundId);
        };
    }

    private stopSound(soundId: number): void {
        const source = this.activeNodes.get(soundId);
        if (source) {
            source.stop();
            source.disconnect();
            this.activeNodes.delete(soundId);
        }
    }

    private applyEnvelope(gainNode: GainNode, envelope: any[]): void {
        const gain = gainNode.gain;
        envelope.forEach((point, index) => {
            const time = point.position / 44100; // Convert samples to seconds
            const value = (point.leftLevel + point.rightLevel) / 32768; // Convert to [0,1] range
            gain.setValueAtTime(value, time);
            if (index < envelope.length - 1) {
                const nextPoint = envelope[index + 1];
                const nextTime = nextPoint.position / 44100;
                gain.linearRampToValueAtTime(value, nextTime);
            }
        });
    }

    public dispose(): void {
        // Stop all playing sounds
        for (const [soundId, source] of this.activeNodes) {
            this.stopSound(soundId);
        }
        
        // Close audio context
        this.audioContext.close();
        
        // Clear maps
        this.sounds.clear();
        this.activeNodes.clear();
    }
}
