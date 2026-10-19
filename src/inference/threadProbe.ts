/// <reference lib="webworker" />
/**
 * Started by the inference worker before it asks onnxruntime-web for WebAssembly threads, which
 * are workers it starts the same way. Answering at all shows such a worker can start here; the
 * answer says whether it can share memory, which the threads need.
 */
(self as unknown as Worker).postMessage({ sharedMemory: typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true });
