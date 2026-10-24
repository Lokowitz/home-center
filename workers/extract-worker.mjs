// Document extraction worker. Uploaded files are untrusted, and parsing them
// (zipped office files, mail, spreadsheets, PDFs) runs here rather than in the
// server process: a decompression bomb or a parser stuck in a synchronous loop
// takes down this thread only, and the parent can terminate it on timeout.
// One file per worker; the parent terminates it after the answer.
//
// The extractors are TypeScript under lib/documents/extract. tsx compiles them
// on load (a runtime dependency, as for the seed), so they aren't duplicated here.
import { parentPort, workerData } from "node:worker_threads"
import { pathToFileURL } from "node:url"
import { register } from "tsx/esm/api"
import { register as registerCjs } from "tsx/cjs/api"

// Registered for this thread only; the server's own module loading is untouched.
// Both loaders: without "type": "module" the .ts files are compiled as CommonJS.
register()
registerCjs()
const { extractFile } = await import(pathToFileURL(workerData.entry).href)

parentPort.once("message", async ({ filePath, ext, opts }) => {
  try {
    parentPort.postMessage({ ok: true, result: await extractFile(filePath, ext, opts) })
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? String(e.name) : "Error"
    // Only ExtractError messages are fixed phrases; anything else can carry document text.
    parentPort.postMessage({ ok: false, name, message: name === "ExtractError" ? String(e.message) : undefined })
  }
})
