/**
 * AI Pipeline Manager
 *
 * Thin wrapper around Transformers.js that:
 *   1. Detects WebGPU / WebGL availability
 *   2. Lazily loads pipelines with progress callbacks
 *   3. Integrates with our IndexedDB cache tracker
 *
 * All heavy work happens on the main thread here, but the Web Worker
 * (worker.js) imports these helpers so inference can be off-loaded.
 */

import { pipeline, env } from "@huggingface/transformers";
import { registerModel, touchModel } from "./cache.js";

// ── Backend detection ──────────────────────────────────────────────

/**
 * Detect the best available backend.
 * @returns {Promise<"webgpu"|"webgl"|"wasm">}
 */
export async function detectBackend() {
  // Check WebGPU
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      /* fall through */
    }
  }

  // Check WebGL 2
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2");
    if (gl) return "webgl";
  } catch {
    /* fall through */
  }

  return "wasm";
}

// ── Model registry ─────────────────────────────────────────────────

/**
 * Defines which Hugging Face model to use for each task.
 * All models are small, quantized ONNX variants.
 */
export const MODEL_MAP = {
  summarization: {
    model: "onnx-community/distilbart-cnn-6-6",
    name: "DistilBART CNN (Summarizer)",
    estimatedSize: 640_000_000,
  },
  sentiment: {
    model: "onnx-community/distilbert-base-uncased-finetuned-sst-2-english",
    name: "DistilBERT SST-2 (Sentiment)",
    estimatedSize: 67_000_000,
  },
  imageClassification: {
    model: "onnx-community/mobilenet_v2_1.0_224",
    name: "MobileNet v2 (Image Classifier)",
    estimatedSize: 13_000_000,
  },
  backgroundRemoval: {
    model: "briaai/RMBG-1.4",
    name: "RMBG 1.4 (Background Removal)",
    estimatedSize: 176_000_000,
  },
};

// ── Pipeline cache (in-memory singletons) ──────────────────────────

const _pipelines = {};

/**
 * Load (or retrieve from memory) a Transformers.js pipeline.
 *
 * @param {"summarization"|"sentiment"|"imageClassification"|"backgroundRemoval"} task
 * @param {(progress: {status:string, progress?:number, file?:string}) => void} [onProgress]
 * @returns {Promise<import("@huggingface/transformers").Pipeline>}
 */
export async function loadPipeline(task, onProgress) {
  if (_pipelines[task]) {
    await touchModel(task);
    return _pipelines[task];
  }

  const spec = MODEL_MAP[task];
  if (!spec) throw new Error(`Unknown task: ${task}`);

  // Determine the best execution device
  const backend = await detectBackend();

  const taskType =
    task === "sentiment"
      ? "text-classification"
      : task === "imageClassification"
        ? "image-classification"
        : task === "backgroundRemoval"
          ? "image-segmentation"
          : task; // "summarization" is already correct

  /** @type {import("@huggingface/transformers").Pipeline} */
  const pipe = await pipeline(taskType, spec.model, {
    device: backend === "webgpu" ? "webgpu" : undefined,
    progress_callback: onProgress,
  });

  _pipelines[task] = pipe;

  // Register in IndexedDB cache tracker
  await registerModel({
    id: task,
    name: spec.name,
    task: taskType,
    sizeBytes: spec.estimatedSize,
  });

  return pipe;
}
