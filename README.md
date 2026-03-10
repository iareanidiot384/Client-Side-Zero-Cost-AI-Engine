# Zero-Cost AI Engine

A fully client-side AI web application. It downloads small, quantized machine-learning models straight into the browser and runs all inference on the user's own hardware. Nothing is sent to a server, ever.

![License](https://img.shields.io/badge/license-MIT-blue)

---

## What It Does

The app ships four AI features, each powered by a lightweight model that runs locally:

| Feature | Model | Approximate Size |
|---|---|---|
| Text Summarizer | DistilBART CNN 6-6 | 640 MB |
| Sentiment Analysis | DistilBERT SST-2 | 67 MB |
| Image Classifier | MobileNet v2 | 13 MB |
| Background Remover | MODNet | 25 MB |

Other highlights:

- **No backend required.** There is no server, no API key, and no running cost.
- **Automatic hardware acceleration.** The app detects whether WebGPU, WebGL, or plain WASM is available and picks the fastest option.
- **Persistent local cache.** Each model is downloaded once and stored in the browser using the Cache API, with metadata tracked in IndexedDB. Subsequent loads are instant.
- **Non-blocking UI.** All heavy computation runs inside a Web Worker so the interface stays responsive.
- **Works offline** after the initial model download.

---

## Tech Stack

| Technology | Role |
|---|---|
| [Transformers.js](https://huggingface.co/docs/transformers.js) | Runs Hugging Face ONNX models inside the browser |
| WebGPU / WebGL | Provides hardware-accelerated inference when available |
| IndexedDB + Cache API | Stores models and metadata locally between sessions |
| Web Workers | Moves inference off the main thread |
| [Vite](https://vitejs.dev) | Development server and production bundler |

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- A recent browser (Chrome 113+, Edge 113+, Firefox 114+, or Safari 17+)

### Install and Run

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

### Production Build

```bash
npm run build
npm run preview   # serves the built output locally
```

The compiled files are written to `dist/`. You can deploy that folder to any static host, Netlify, Vercel, GitHub Pages, an S3 bucket, and so on.

---

## How It Works

```
+----------------------------------------------+
|                   Browser                     |
|                                               |
|  +---------+    postMessage    +-----------+  |
|  | Main UI | <--------------> | Web Worker |  |
|  |  (DOM)  |                  |            |  |
|  +---------+                  | Transformers  |
|                               | .js Pipeline  |
|                               +------+------+ |
|                                      |        |
|                         +------------+------+ |
|                         |  WebGPU / WebGL   | |
|                         |  (GPU-accelerated)| |
|                         +------------+------+ |
|                                      |        |
|                         +------------+------+ |
|                         | Cache API +       | |
|                         | IndexedDB         | |
|                         | (model storage)   | |
|                         +-------------------+ |
+----------------------------------------------+
          ^  first download only  ^
          |                       |
     Hugging Face CDN
```

1. **First visit**, The chosen model is fetched from the Hugging Face CDN and written into the browser's Cache API. An IndexedDB record tracks its name, task, and size.
2. **Return visits**, The model loads directly from the local cache with no network traffic.
3. **Inference**, A Web Worker runs the Transformers.js pipeline. The runtime automatically falls back from WebGPU to WebGL to WASM depending on what the browser supports.
4. **Privacy**, User data never leaves the device. All processing is local.

---

## Project Structure

```
.
+-- index.html                  Entry point
+-- vite.config.js              Vite configuration
+-- package.json
+-- public/
|   +-- favicon.svg
+-- src/
|   +-- main.js                 UI wiring and worker orchestration
|   +-- style.css               Stylesheet
|   +-- engine/
|       +-- cache.js            IndexedDB cache manager
|       +-- pipeline.js         Transformers.js pipeline loader
|       +-- worker.js           Web Worker for off-thread inference
+-- README.md
```

---

## License

MIT
