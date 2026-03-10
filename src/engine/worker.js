/**
 * Web Worker, AI Inference
 *
 * Runs Transformers.js pipelines off the main thread so the UI never freezes.
 * Communicates with the main thread via postMessage:
 *
 *   Main → Worker:  { type: "run", task, payload }
 *   Worker → Main:  { type: "progress", ... }
 *                    { type: "result", data }
 *                    { type: "error", message }
 */

import { loadPipeline } from "./pipeline.js";

self.addEventListener("message", async (e) => {
  const { type, task, payload } = e.data;

  if (type !== "run") return;

  try {
    // Forward download progress back to main thread
    const onProgress = (p) => {
      self.postMessage({ type: "progress", ...p });
    };

    const pipe = await loadPipeline(task, onProgress);

    let result;

    switch (task) {
      case "summarization": {
        const out = await pipe(payload.text, {
          max_new_tokens: 128,
          min_length: 30,
        });
        result = out[0].summary_text;
        break;
      }

      case "sentiment": {
        const out = await pipe(payload.text);
        result = out; // [{ label, score }]
        break;
      }

      case "imageClassification": {
        const out = await pipe(payload.imageURL, { topk: 5 });
        result = out; // [{ label, score }, ...]
        break;
      }

      case "backgroundRemoval": {
        const out = await pipe(payload.imageURL);
        // image-segmentation returns array of { label, score, mask }
        // We'll send back the mask as an ImageBitmap-friendly structure
        result = out;
        break;
      }

      default:
        throw new Error(`Unknown task: ${task}`);
    }

    self.postMessage({ type: "result", data: result });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message ?? String(err) });
  }
});
