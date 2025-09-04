import { BaseTagHandler, TagData } from '../tag-handler';
import { SwfTagCode } from '../tags';
import { Frame, DisplayList } from '../../swf/display';
import { Color } from '../../swf/shapes';

export enum FilterType {
    DropShadow = 0,
    Blur = 1,
    Glow = 2,
    Bevel = 3,
    GradientGlow = 4,
    Convolution = 5,
    ColorMatrix = 6,
    GradientBevel = 7
}

export interface FilterBase {
    type: FilterType;
}

export interface DropShadowFilter extends FilterBase {
    type: FilterType.DropShadow;
    color: Color;
    blurX: number;
    blurY: number;
    angle: number;
    distance: number;
    strength: number;
    innerShadow: boolean;
    knockout: boolean;
    compositeSource: boolean;
    passes: number;
}

export interface BlurFilter extends FilterBase {
    type: FilterType.Blur;
    blurX: number;
    blurY: number;
    passes: number;
}

export interface ConvolutionFilter extends FilterBase {
    type: FilterType.Convolution;
    matrixX: number;
    matrixY: number;
    matrix: number[];
    divisor: number;
    bias: number;
    preserveAlpha: boolean;
    clamp: boolean;
    color: Color;
}

export type Filter = DropShadowFilter | BlurFilter | ConvolutionFilter;

export class FilterShaderGenerator {
    generateShader(filter: Filter): { vs: string; fs: string } {
        switch (filter.type) {
            case FilterType.DropShadow:
                return this.generateDropShadowShader(filter);
            case FilterType.Blur:
                return this.generateBlurShader(filter);
            case FilterType.Convolution:
                return this.generateConvolutionShader(filter);
            default:
                throw new Error(`Unsupported filter type: ${filter.type}`);
        }
    }

    private generateDropShadowShader(filter: DropShadowFilter): { vs: string; fs: string } {
        const vs = `
            attribute vec2 aPosition;
            attribute vec2 aTexCoord;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying vec2 vTexCoord;
            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 0.0, 1.0);
                vTexCoord = aTexCoord;
            }`;

        const fs = `
            precision mediump float;
            varying vec2 vTexCoord;
            uniform sampler2D uTexture;
            uniform vec4 uShadowColor;
            uniform vec2 uOffset;
            uniform float uStrength;
            uniform bool uInnerShadow;
            uniform bool uKnockout;

            void main() {
                vec4 original = texture2D(uTexture, vTexCoord);
                vec4 shadow = texture2D(uTexture, vTexCoord - uOffset);
                shadow *= uShadowColor;
                shadow *= uStrength;
                
                if (uInnerShadow) {
                    shadow *= original.a;
                    gl_FragColor = mix(original, shadow, shadow.a);
                } else {
                    shadow *= (1.0 - original.a);
                    gl_FragColor = uKnockout ? shadow : original + shadow;
                }
            }`;

        return { vs, fs };
    }

    private generateBlurShader(filter: BlurFilter): { vs: string; fs: string } {
        const vs = `
            attribute vec2 aPosition;
            attribute vec2 aTexCoord;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying vec2 vTexCoord;
            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 0.0, 1.0);
                vTexCoord = aTexCoord;
            }`;

        const fs = `
            precision mediump float;
            varying vec2 vTexCoord;
            uniform sampler2D uTexture;
            uniform vec2 uBlurDirection;
            uniform float uBlurAmount;

            void main() {
                vec4 color = vec4(0.0);
                float total = 0.0;
                
                for(float i = -4.0; i <= 4.0; i++) {
                    float weight = exp(-0.5 * i * i / (uBlurAmount * uBlurAmount));
                    color += texture2D(uTexture, vTexCoord + i * uBlurDirection) * weight;
                    total += weight;
                }
                
                gl_FragColor = color / total;
            }`;

        return { vs, fs };
    }

    private generateConvolutionShader(filter: ConvolutionFilter): { vs: string; fs: string } {
        const vs = `
            attribute vec2 aPosition;
            attribute vec2 aTexCoord;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying vec2 vTexCoord;
            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 0.0, 1.0);
                vTexCoord = aTexCoord;
            }`;

        // Generate convolution shader dynamically based on matrix size
        const matrixDefines = `const int MATRIX_WIDTH = ${filter.matrixX};\nconst int MATRIX_HEIGHT = ${filter.matrixY};`;
        const matrixUniforms = `uniform float uMatrix[${filter.matrixX * filter.matrixY}];`;

        const fs = `
            precision mediump float;
            ${matrixDefines}
            varying vec2 vTexCoord;
            uniform sampler2D uTexture;
            uniform float uDivisor;
            uniform float uBias;
            uniform bool uPreserveAlpha;
            uniform bool uClamp;
            ${matrixUniforms}

            void main() {
                vec4 result = vec4(0.0);
                float alpha = texture2D(uTexture, vTexCoord).a;
                
                for(int y = 0; y < MATRIX_HEIGHT; y++) {
                    for(int x = 0; x < MATRIX_WIDTH; x++) {
                        int index = y * MATRIX_WIDTH + x;
                        vec2 offset = vec2(float(x - MATRIX_WIDTH/2), float(y - MATRIX_HEIGHT/2));
                        vec4 sample = texture2D(uTexture, vTexCoord + offset / vec2(textureSize(uTexture, 0)));
                        result += sample * uMatrix[index];
                    }
                }
                
                result = result / uDivisor + uBias;
                if (uClamp) {
                    result = clamp(result, 0.0, 1.0);
                }
                if (uPreserveAlpha) {
                    result.a = alpha;
                }
                
                gl_FragColor = result;
            }`;

        return { vs, fs };
    }
}

export class FilterHandler extends BaseTagHandler {
    private shaderGenerator = new FilterShaderGenerator();

    canHandle(tag: TagData): boolean {
        return tag.code === SwfTagCode.PlaceObject2 || tag.code === SwfTagCode.PlaceObject3;
    }

    async handle(tag: TagData, frame: Frame, displayList: DisplayList): Promise<void> {
        try {
            const data = tag.data;
            const flags = data.readUint8();
            if (tag.code === SwfTagCode.PlaceObject3) {
                const hasFilters = !!(data.readUint8() & 0x01);
                if (hasFilters) {
                    const filters = this.readFilterList(data);
                    frame.actions.push({
                        type: 'placeObject',
                        data: { filters }
                    });
                }
            }
        } catch (error) {
            this.handleError(tag, error as Error);
        }
    }

    private readFilterList(data: any): Filter[] {
        const numberOfFilters = data.readUint8();
        const filters: Filter[] = [];

        for (let i = 0; i < numberOfFilters; i++) {
            const filterId = data.readUint8();
            filters.push(this.readFilter(data, filterId));
        }

        return filters;
    }

    private readFilter(data: any, filterId: number): Filter {
        switch (filterId) {
            case FilterType.DropShadow:
                return this.readDropShadowFilter(data);
            case FilterType.Blur:
                return this.readBlurFilter(data);
            case FilterType.Convolution:
                return this.readConvolutionFilter(data);
            default:
                throw new Error(`Unsupported filter type: ${filterId}`);
        }
    }

    private readDropShadowFilter(data: any): DropShadowFilter {
        return {
            type: FilterType.DropShadow,
            color: this.readRGBA(data),
            blurX: data.readFixed(),
            blurY: data.readFixed(),
            angle: data.readFixed(),
            distance: data.readFixed(),
            strength: data.readFixed8(),
            innerShadow: data.readBit(),
            knockout: data.readBit(),
            compositeSource: data.readBit(),
            passes: data.readUBits(5)
        };
    }

    private readBlurFilter(data: any): BlurFilter {
        return {
            type: FilterType.Blur,
            blurX: data.readFixed(),
            blurY: data.readFixed(),
            passes: data.readUBits(5)
        };
    }

    private readConvolutionFilter(data: any): ConvolutionFilter {
        const matrixX = data.readUint8();
        const matrixY = data.readUint8();
        const divisor = data.readFloat();
        const bias = data.readFloat();

        const matrix: number[] = [];
        for (let y = 0; y < matrixY; y++) {
            for (let x = 0; x < matrixX; x++) {
                matrix.push(data.readFloat());
            }
        }

        const color = this.readRGBA(data);
        data.readUBits(6); // reserved
        const clamp = data.readBit();
        const preserveAlpha = data.readBit();

        return {
            type: FilterType.Convolution,
            matrixX,
            matrixY,
            matrix,
            divisor,
            bias,
            color,
            clamp,
            preserveAlpha
        };
    }

    private readRGBA(data: any): Color {
        return {
            r: data.readUint8() / 255,
            g: data.readUint8() / 255,
            b: data.readUint8() / 255,
            a: data.readUint8() / 255
        };
    }
}
