import { SWFPlayer } from './swf-player';

// Exportar classes principais
export { SWFPlayer } from './swf-player';
export { WebGLRenderer } from './gl/renderer';
export { loadSwf } from './swf/loader';
export { parseSwf } from './swf/parser';
export { parseShape } from './swf/shapes';
export * from './swf/shapes';
export * from './swf/display';
export * from './utils/bytes';

// Interface principal para uso no browser
class SWFRenderer {
    private player: SWFPlayer;
    private canvas: HTMLCanvasElement;
    private controls: HTMLElement | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.player = new SWFPlayer(canvas);
        this.setupCanvas();
    }

    private setupCanvas() {
        this.canvas.style.border = '1px solid #ccc';
        this.canvas.style.display = 'block';
        this.canvas.style.margin = '0 auto';
    }

    async loadSWF(source: string | File): Promise<void> {
        try {
            await this.player.loadSWF(source);
            this.createControls();
        } catch (error) {
            console.error('Erro ao carregar SWF:', error);
            throw error;
        }
    }

    private createControls() {
        if (this.controls) {
            this.controls.remove();
        }

        this.controls = document.createElement('div');
        this.controls.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            margin: 10px 0;
            padding: 10px;
            background: #f5f5f5;
            border-radius: 5px;
            font-family: Arial, sans-serif;
        `;

        // Botão Play/Pause
        const playButton = document.createElement('button');
        playButton.textContent = '▶️ Play';
        playButton.style.cssText = `
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            background: #007bff;
            color: white;
            cursor: pointer;
            font-size: 14px;
        `;

        let isPlaying = false;
        playButton.addEventListener('click', () => {
            if (isPlaying) {
                this.player.pause();
                playButton.textContent = '▶️ Play';
                isPlaying = false;
            } else {
                this.player.play();
                playButton.textContent = '⏸️ Pause';
                isPlaying = true;
            }
        });

        // Botão Stop
        const stopButton = document.createElement('button');
        stopButton.textContent = '⏹️ Stop';
        stopButton.style.cssText = playButton.style.cssText;
        stopButton.style.background = '#dc3545';
        stopButton.addEventListener('click', () => {
            this.player.stop();
            playButton.textContent = '▶️ Play';
            isPlaying = false;
            frameSlider.value = '0';
            frameInfo.textContent = `Frame: 1 / ${this.player.getTotalFrames()}`;
        });

        // Slider de frames
        const frameSlider = document.createElement('input');
        frameSlider.type = 'range';
        frameSlider.min = '0';
        frameSlider.max = String(this.player.getTotalFrames() - 1);
        frameSlider.value = '0';
        frameSlider.style.cssText = `
            width: 200px;
            margin: 0 10px;
        `;

        frameSlider.addEventListener('input', () => {
            const frame = parseInt(frameSlider.value);
            this.player.gotoFrame(frame);
            frameInfo.textContent = `Frame: ${frame + 1} / ${this.player.getTotalFrames()}`;
        });

        // Info de frames
        const frameInfo = document.createElement('span');
        frameInfo.textContent = `Frame: 1 / ${this.player.getTotalFrames()}`;
        frameInfo.style.cssText = `
            font-size: 14px;
            color: #666;
            min-width: 120px;
        `;

        // Atualizar info de frames durante reprodução
        const updateFrameInfo = () => {
            if (isPlaying) {
                const currentFrame = this.player.getCurrentFrame();
                frameSlider.value = String(currentFrame);
                frameInfo.textContent = `Frame: ${currentFrame + 1} / ${this.player.getTotalFrames()}`;
            }
            requestAnimationFrame(updateFrameInfo);
        };
        updateFrameInfo();

        this.controls.appendChild(playButton);
        this.controls.appendChild(stopButton);
        this.controls.appendChild(frameSlider);
        this.controls.appendChild(frameInfo);

        // Inserir controles após o canvas
        this.canvas.parentNode?.insertBefore(this.controls, this.canvas.nextSibling);
    }

    play() {
        this.player.play();
    }

    pause() {
        this.player.pause();
    }

    stop() {
        this.player.stop();
    }

    gotoFrame(frame: number) {
        this.player.gotoFrame(frame);
    }

    getCurrentFrame(): number {
        return this.player.getCurrentFrame();
    }

    getTotalFrames(): number {
        return this.player.getTotalFrames();
    }

    destroy() {
        if (this.controls) {
            this.controls.remove();
            this.controls = null;
        }
        this.player.stop();
    }
}

// Disponibilizar globalmente
(window as any).SWFRenderer = SWFRenderer;

// Inicialização automática quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    console.log('SWF Renderer carregado e pronto para uso!');

    // Exemplo de uso automático se houver um canvas com id 'swf-canvas'
    const canvas = document.getElementById('swf-canvas') as HTMLCanvasElement;
    if (canvas) {
        const renderer = new SWFRenderer(canvas);
        (window as any).swfRenderer = renderer;

        // Adicionar drag & drop
        setupDragAndDrop(canvas, renderer);
    }
});

function setupDragAndDrop(canvas: HTMLCanvasElement, renderer: SWFRenderer) {
    const dropZone = canvas.parentElement || document.body;

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#e3f2fd';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '';
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '';

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.name.toLowerCase().endsWith('.swf')) {
                try {
                    await renderer.loadSWF(file);
                    console.log('Arquivo SWF carregado via drag & drop!');
                } catch (error) {
                    console.error('Erro ao carregar SWF via drag & drop:', error);
                }
            }
        }
    });
}

export default SWFRenderer;
