/**
 * Ambient type declarations for Chrome's built-in Prompt API (`LanguageModel`),
 * including multimodal (text + image) inputs. Not yet part of lib.dom.d.ts, so
 * we declare it here. Callers must still feature-detect at runtime — newest
 * Chrome on desktop only (Origin Trial / stable depending on the channel):
 * https://developer.chrome.com/docs/ai/prompt-api
 *
 * This file is intentionally a global script (no imports/exports) so the
 * declarations land on `globalThis`.
 */

type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelTextInput {
  type: 'text';
  languages: string[];
}

interface LanguageModelImageInput {
  type: 'image';
}

interface LanguageModelAudioInput {
  type: 'audio';
}

type LanguageModelExpectedInput =
  | LanguageModelTextInput
  | LanguageModelImageInput
  | LanguageModelAudioInput
  | { type: string; languages?: string[] };

interface LanguageModelExpectedOutput {
  type: 'text';
  languages: string[];
}

interface LanguageModelDownloadProgressEvent extends Event {
  loaded: number;
  total: number;
}

interface LanguageModelMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: LanguageModelDownloadProgressEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

type LanguageModelImageValue =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | Blob
  | ImageData;

interface LanguageModelMessageContent {
  type: 'text' | 'image';
  value: string | LanguageModelImageValue;
}

interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LanguageModelMessageContent[];
}

interface LanguageModelCreateOptions {
  expectedInputs?: LanguageModelExpectedInput[];
  expectedOutputs?: LanguageModelExpectedOutput[];
  monitor?: (monitor: LanguageModelMonitor) => void;
  signal?: AbortSignal;
  temperature?: number;
  topK?: number;
  initialPrompts?: LanguageModelMessage[];
}

interface LanguageModelSession {
  prompt(input: string | LanguageModelMessage[]): Promise<string>;
  promptStreaming(input: string | LanguageModelMessage[]): ReadableStream<string>;
  destroy(): void;
  clone(): Promise<LanguageModelSession>;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

interface LanguageModelStatic {
  availability(options?: LanguageModelCreateOptions): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  params?(): Promise<unknown>;
}

declare const LanguageModel: LanguageModelStatic;

interface Window {
  LanguageModel?: LanguageModelStatic;
}
