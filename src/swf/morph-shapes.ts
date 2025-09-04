import {Shape} from "./shapes";

export interface MorphShape {
    startShape: Shape;
    endShape: Shape;
    startEdges: {
        vertices: number[];
        indices: number[];
    };
    endEdges: {
        vertices: number[];
        indices: number[];
    };
    startFills: {
        type: string;
        color?: Color;
        gradient?: any;
    }[];
    endFills: {
        type: string;
        color?: Color;
        gradient?: any;
    }[];
    ratio?: number; // Added ratio property
}

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}
