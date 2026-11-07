// Minimal ambient declarations for the AudioWorkletGlobalScope, which lib.dom does not include.
declare const sampleRate: number
declare const currentTime: number
declare const currentFrame: number

interface AudioWorkletProcessorImpl {
  readonly port: MessagePort
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessorImpl
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessorImpl
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessorImpl,
): void
