/**
 * Main application entry point
 *
 * Wires up the UI tabs, dropzones, and buttons to the AI Web Worker.
 * All inference runs in a Web Worker, this file only handles DOM logic.
 */

import "./style.css";
import { detectBackend, MODEL_MAP } from "./engine/pipeline.js";
import { listModels, clearAll, formatBytes } from "./engine/cache.js";

// ── Web Worker ─────────────────────────────────────────────────────

const worker = new Worker(new URL("./engine/worker.js", import.meta.url), {
  type: "module",
});

/**
 * Send a task to the worker and return a promise that resolves with the result.
 * Progress events are forwarded to `onProgress`.
 */
function runWorker(task, payload, onProgress) {
  return new Promise((resolve, reject) => {
    function handler(e) {
      const msg = e.data;
      if (msg.type === "progress" && onProgress) {
        onProgress(msg);
      } else if (msg.type === "result") {
        worker.removeEventListener("message", handler);
        resolve(msg.data);
      } else if (msg.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(msg.message));
      }
    }
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "run", task, payload });
  });
}

// ── DOM refs ───────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const overlay = $("#loading-overlay");
const loadingText = $("#loading-text");
const loadingProgress = $("#loading-progress");
const loadingPercent = $("#loading-percent");

// ── Hardware info ──────────────────────────────────────────────────

(async () => {
  const backend = await detectBackend();
  const badge = $("#hw-badge");
  const labels = { webgpu: "WebGPU", webgl: "WebGL", wasm: "WASM" };
  badge.textContent = labels[backend] ?? backend;
  badge.className = backend;
  $("#hw-info").hidden = false;
})();

// ── Tabs ───────────────────────────────────────────────────────────

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");

    const target = tab.dataset.tab;
    $$(".panel").forEach((p) => {
      p.hidden = true;
      p.classList.remove("active");
    });
    const panel = $(`#panel-${target}`);
    panel.hidden = false;
    panel.classList.add("active");

    // Refresh cache tab when selected
    if (target === "cache") refreshCacheUI();
  });
});

// ── Loading overlay helpers ────────────────────────────────────────

let _lastProgressFile = "";

function showOverlay(text = "Downloading model…") {
  loadingText.textContent = text;
  loadingProgress.style.width = "0%";
  loadingPercent.textContent = "";
  _lastProgressFile = "";
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

function handleProgress(p) {
  if (p.status === "download" || p.status === "progress") {
    if (p.file && p.file !== _lastProgressFile) {
      _lastProgressFile = p.file;
      const shortName = p.file.split("/").pop();
      loadingText.textContent = `Downloading ${shortName}…`;
    }
    if (typeof p.progress === "number") {
      const pct = Math.round(p.progress);
      loadingProgress.style.width = `${pct}%`;
      loadingPercent.textContent = `${pct}%`;
    }
  } else if (p.status === "init" || p.status === "ready") {
    loadingText.textContent = "Initializing model…";
    loadingProgress.style.width = "100%";
    loadingPercent.textContent = "";
  }
}

// ── Status / output helpers ────────────────────────────────────────

function setStatus(id, text, show = true) {
  const el = $(`#${id}-status`);
  el.textContent = text;
  el.hidden = !show;
}

function showOutput(id, html) {
  const el = $(`#${id}-output`);
  el.innerHTML = html;
  el.hidden = false;
}

// ── Summarizer ─────────────────────────────────────────────────────

const sumInput = $("#summarizer-input");
const sumBtn = $("#summarizer-run");

sumInput.addEventListener("input", () => {
  sumBtn.disabled = sumInput.value.trim().length < 40;
});

sumBtn.addEventListener("click", async () => {
  const text = sumInput.value.trim();
  if (!text) return;

  sumBtn.disabled = true;
  setStatus("summarizer", "Loading model…");
  showOverlay("Loading summarization model…");

  try {
    const start = performance.now();
    const result = await runWorker("summarization", { text }, handleProgress);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    hideOverlay();
    setStatus("summarizer", `Done in ${elapsed}s, processed entirely on your device`);
    showOutput("summarizer", escapeHtml(result));
  } catch (err) {
    hideOverlay();
    setStatus("summarizer", `Error: ${err.message}`);
  } finally {
    sumBtn.disabled = false;
  }
});

// ── Sentiment ──────────────────────────────────────────────────────

const sentInput = $("#sentiment-input");
const sentBtn = $("#sentiment-run");

sentInput.addEventListener("input", () => {
  sentBtn.disabled = sentInput.value.trim().length < 2;
});

sentBtn.addEventListener("click", async () => {
  const text = sentInput.value.trim();
  if (!text) return;

  sentBtn.disabled = true;
  setStatus("sentiment", "Loading model…");
  showOverlay("Loading sentiment model…");

  try {
    const start = performance.now();
    const results = await runWorker("sentiment", { text }, handleProgress);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    hideOverlay();
    setStatus("sentiment", `Done in ${elapsed}s, processed entirely on your device`);

    // Build bar chart
    let html = '<div class="sentiment-bar-group">';
    for (const r of results) {
      const pct = (r.score * 100).toFixed(1);
      const cls = r.label.toLowerCase().includes("pos")
        ? "positive"
        : r.label.toLowerCase().includes("neg")
          ? "negative"
          : "neutral";
      html += `
        <div class="sentiment-bar">
          <span class="label">${escapeHtml(r.label)}</span>
          <div class="bar"><div class="fill ${cls}" style="width:${pct}%"></div></div>
          <span class="pct">${pct}%</span>
        </div>`;
    }
    html += "</div>";
    showOutput("sentiment", html);
  } catch (err) {
    hideOverlay();
    setStatus("sentiment", `Error: ${err.message}`);
  } finally {
    sentBtn.disabled = false;
  }
});

// ── Image Classification ───────────────────────────────────────────

const icFile = $("#image-class-file");
const icDropzone = $("#image-class-dropzone");
const icBrowse = $("#image-class-browse");
const icPreview = $("#image-class-preview");
const icBtn = $("#image-class-run");

let _icImageURL = null;

icBrowse.addEventListener("click", () => icFile.click());
icDropzone.addEventListener("click", (e) => {
  if (e.target !== icBrowse) icFile.click();
});

setupDropzone(icDropzone, icFile, (url) => {
  _icImageURL = url;
  icPreview.src = url;
  icPreview.hidden = false;
  icBtn.disabled = false;
});

icBtn.addEventListener("click", async () => {
  if (!_icImageURL) return;

  icBtn.disabled = true;
  setStatus("image-class", "Loading model…");
  showOverlay("Loading image classification model…");

  try {
    const start = performance.now();
    const results = await runWorker(
      "imageClassification",
      { imageURL: _icImageURL },
      handleProgress
    );
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    hideOverlay();
    setStatus("image-class", `Done in ${elapsed}s, processed entirely on your device`);

    let html = '<div class="class-results">';
    for (const r of results) {
      const pct = (r.score * 100).toFixed(1);
      html += `
        <div class="class-result">
          <span class="label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          <span class="pct">${pct}%</span>
        </div>`;
    }
    html += "</div>";
    showOutput("image-class", html);
  } catch (err) {
    hideOverlay();
    setStatus("image-class", `Error: ${err.message}`);
  } finally {
    icBtn.disabled = false;
  }
});

// ── Background Removal ─────────────────────────────────────────────

const bgFile = $("#bg-remove-file");
const bgDropzone = $("#bg-remove-dropzone");
const bgBrowse = $("#bg-remove-browse");
const bgPreview = $("#bg-remove-preview");
const bgBtn = $("#bg-remove-run");
const bgCanvas = $("#bg-remove-canvas");
const bgDownload = $("#bg-remove-download");

let _bgImageURL = null;

bgBrowse.addEventListener("click", () => bgFile.click());
bgDropzone.addEventListener("click", (e) => {
  if (e.target !== bgBrowse) bgFile.click();
});

setupDropzone(bgDropzone, bgFile, (url) => {
  _bgImageURL = url;
  bgPreview.src = url;
  bgPreview.hidden = false;
  bgBtn.disabled = false;
  bgCanvas.hidden = true;
  bgDownload.hidden = true;
});

bgBtn.addEventListener("click", async () => {
  if (!_bgImageURL) return;

  bgBtn.disabled = true;
  setStatus("bg-remove", "Loading model…");
  showOverlay("Loading background removal model…");

  try {
    const start = performance.now();
    const results = await runWorker(
      "backgroundRemoval",
      { imageURL: _bgImageURL },
      handleProgress
    );
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    hideOverlay();
    setStatus("bg-remove", `Done in ${elapsed}s, processed entirely on your device`);

    // Composite the original image with the mask
    await compositeResult(results);
  } catch (err) {
    hideOverlay();
    setStatus("bg-remove", `Error: ${err.message}`);
  } finally {
    bgBtn.disabled = false;
  }
});

/**
 * Take segmentation output and composite the foreground onto a transparent
 * background using the mask, then draw onto the canvas.
 */
async function compositeResult(segResults) {
  const outputEl = $("#bg-remove-output");
  outputEl.hidden = false;

  // Load original image
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve) => {
    img.onload = resolve;
    img.src = _bgImageURL;
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  bgCanvas.width = W;
  bgCanvas.height = H;
  bgCanvas.hidden = false;

  const ctx = bgCanvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, W, H);
  const data = imageData.data;

  // The segmentation result contains mask data
  // MODNet returns a single segment with a mask RawImage
  if (segResults && segResults.length > 0) {
    const seg = segResults[0];
    if (seg.mask && seg.mask.data) {
      const maskData = seg.mask.data;
      const maskW = seg.mask.width;
      const maskH = seg.mask.height;

      // Create a temporary canvas for resizing the mask if needed
      if (maskW !== W || maskH !== H) {
        const tmpCanvas = new OffscreenCanvas(maskW, maskH);
        const tmpCtx = tmpCanvas.getContext("2d");
        const tmpImg = tmpCtx.createImageData(maskW, maskH);
        for (let i = 0; i < maskData.length; i++) {
          const val = Math.round(maskData[i] * 255);
          tmpImg.data[i * 4 + 0] = val;
          tmpImg.data[i * 4 + 1] = val;
          tmpImg.data[i * 4 + 2] = val;
          tmpImg.data[i * 4 + 3] = 255;
        }
        tmpCtx.putImageData(tmpImg, 0, 0);

        // Resize to match original image
        const resized = new OffscreenCanvas(W, H);
        const rCtx = resized.getContext("2d");
        rCtx.drawImage(tmpCanvas, 0, 0, W, H);
        const resizedData = rCtx.getImageData(0, 0, W, H).data;

        // Apply mask to alpha channel
        for (let i = 0; i < W * H; i++) {
          data[i * 4 + 3] = resizedData[i * 4]; // Use R channel as alpha
        }
      } else {
        // Same size, apply directly
        for (let i = 0; i < W * H; i++) {
          data[i * 4 + 3] = Math.round(maskData[i] * 255);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  // Enable download
  bgDownload.hidden = false;
  bgDownload.href = bgCanvas.toDataURL("image/png");
  bgDownload.download = "background-removed.png";
}

// ── Cache Management ───────────────────────────────────────────────

async function refreshCacheUI() {
  const container = $("#cache-list");
  try {
    const models = await listModels();
    if (models.length === 0) {
      container.innerHTML = '<p class="muted">No models cached yet. Use a feature above to download one.</p>';
      return;
    }
    let html = "";
    for (const m of models) {
      html += `
        <div class="cache-item">
          <span class="name">${escapeHtml(m.name)}</span>
          <span class="size">${formatBytes(m.sizeBytes)}</span>
        </div>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p class="muted">Could not read cache data.</p>';
  }
}

$("#cache-clear").addEventListener("click", async () => {
  if (!confirm("This will remove all cached models. You'll need to re-download them next time. Continue?")) return;
  await clearAll();
  refreshCacheUI();
});

// ── Dropzone utility ───────────────────────────────────────────────

function setupDropzone(zone, fileInput, onImage) {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragover");
  });

  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      onImage(URL.createObjectURL(file));
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) {
      onImage(URL.createObjectURL(file));
    }
  });
}

// ── Utilities ──────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
