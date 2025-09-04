import { ParserError } from '../utils/bytes';

export interface BlendMode {
    readonly name: string;
    readonly srcFactor: number;
    readonly dstFactor: number;
    readonly equation?: number;
    readonly shader?: string;
}

export class BlendModeManager {
    private gl: WebGLRenderingContext;
    private isWebGL2: boolean;
    private currentMode: string = 'NORMAL';
    private extensionBlend: any;

    static readonly BLEND_MODES: { [key: string]: BlendMode } = {
        NORMAL: {
            name: 'normal',
            srcFactor: WebGLRenderingContext.SRC_ALPHA,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA
        },
        MULTIPLY: {
            name: 'multiply',
            srcFactor: WebGLRenderingContext.DST_COLOR,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return src * dst;
                }
            `
        },
        SCREEN: {
            name: 'screen',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_COLOR,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return src + dst - (src * dst);
                }
            `
        },
        LIGHTEN: {
            name: 'lighten',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE,
            equation: 0x8008, // EXT_blend_minmax.MAX_EXT constant value
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return max(src, dst);
                }
            `
        },
        DARKEN: {
            name: 'darken',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE,
            equation: 0x8007, // EXT_blend_minmax.MIN_EXT constant value
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return min(src, dst);
                }
            `
        },
        DIFFERENCE: {
            name: 'difference',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return abs(dst - src);
                }
            `
        },
        ADD: {
            name: 'add',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE
        },
        SUBTRACT: {
            name: 'subtract',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return max(dst - src, vec4(0.0));
                }
            `
        },
        INVERT: {
            name: 'invert',
            srcFactor: WebGLRenderingContext.ZERO,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_COLOR,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return vec4(1.0) - dst;
                }
            `
        },
        ALPHA: {
            name: 'alpha',
            srcFactor: WebGLRenderingContext.DST_ALPHA,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA
        },
        ERASE: {
            name: 'erase',
            srcFactor: WebGLRenderingContext.ZERO,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    return vec4(dst.rgb, dst.a * (1.0 - src.a));
                }
            `
        },
        OVERLAY: {
            name: 'overlay',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    vec4 result;
                    for(int i = 0; i < 3; i++) {
                        if(dst[i] < 0.5) {
                            result[i] = 2.0 * src[i] * dst[i];
                        } else {
                            result[i] = 1.0 - 2.0 * (1.0 - src[i]) * (1.0 - dst[i]);
                        }
                    }
                    result.a = src.a + dst.a * (1.0 - src.a);
                    return result;
                }
            `
        },
        HARDLIGHT: {
            name: 'hardlight',
            srcFactor: WebGLRenderingContext.ONE,
            dstFactor: WebGLRenderingContext.ONE_MINUS_SRC_ALPHA,
            shader: `
                vec4 blend(vec4 src, vec4 dst) {
                    vec4 result;
                    for(int i = 0; i < 3; i++) {
                        if(src[i] < 0.5) {
                            result[i] = 2.0 * src[i] * dst[i];
                        } else {
                            result[i] = 1.0 - 2.0 * (1.0 - src[i]) * (1.0 - dst[i]);
                        }
                    }
                    result.a = src.a + dst.a * (1.0 - src.a);
                    return result;
                }
            `
        }
    };

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;
        this.isWebGL2 = 'WebGL2RenderingContext' in window && gl instanceof (window as any).WebGL2RenderingContext;
        this.setupBlendExtensions();
    }

    private setupBlendExtensions() {
        if (!this.isWebGL2) {
            this.extensionBlend = this.gl.getExtension('EXT_blend_minmax');
            if (!this.extensionBlend) {
                console.warn('EXT_blend_minmax extension not supported. Some blend modes may not work correctly.');
            }
        }
    }

    setBlendMode(mode: string | number): void {
        const blendMode = this.getBlendMode(mode);
        if (blendMode === this.currentMode) return;

        const params = BlendModeManager.BLEND_MODES[blendMode];
        if (!params) {
            throw new ParserError(`Unsupported blend mode: ${mode}`, 0);
        }

        this.gl.blendFunc(params.srcFactor, params.dstFactor);
        
        if (params.equation !== undefined) {
            if (this.isWebGL2) {
                (this.gl as WebGL2RenderingContext).blendEquation(params.equation);
            } else if (this.extensionBlend) {
                this.extensionBlend.blendEquation(params.equation);
            }
        } else {
            if (this.isWebGL2) {
                (this.gl as WebGL2RenderingContext).blendEquation(this.gl.FUNC_ADD);
            } else if (this.extensionBlend) {
                this.extensionBlend.blendEquation(this.gl.FUNC_ADD);
            }
        }

        this.currentMode = blendMode;
    }

    private getBlendMode(mode: string | number): string {
        if (typeof mode === 'string') {
            return mode.toUpperCase();
        }

        switch (mode) {
            case 1: return 'NORMAL';
            case 2: return 'LAYER';
            case 3: return 'MULTIPLY';
            case 4: return 'SCREEN';
            case 5: return 'LIGHTEN';
            case 6: return 'DARKEN';
            case 7: return 'DIFFERENCE';
            case 8: return 'ADD';
            case 9: return 'SUBTRACT';
            case 10: return 'INVERT';
            case 11: return 'ALPHA';
            case 12: return 'ERASE';
            case 13: return 'OVERLAY';
            case 14: return 'HARDLIGHT';
            default: return 'NORMAL';
        }
    }

    resetBlendMode(): void {
        this.setBlendMode('NORMAL');
    }

    getBlendShader(mode: string): string | undefined {
        const params = BlendModeManager.BLEND_MODES[mode.toUpperCase()];
        return params?.shader;
    }

    supportsAdvancedBlending(): boolean {
        return this.isWebGL2 || !!this.extensionBlend;
    }
}
