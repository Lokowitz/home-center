// Engine file: relative imports and npm packages only.
// Every archive is a zip written and read as a stream (zip.js, ZIP64), so a
// multi-gigabyte upload folder never sits in memory.
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { createHash } from "node:crypto"
import { configure, Reader, TextWriter, Uint8ArrayReader, ZipReader, ZipWriter, type FileEntry } from "@zip.js/zip.js"
import { MANIFEST_ENTRY, type Manifest, type ManifestFile } from "./format"

configure({ useWebWorkers: false })

const encode = (s: string) => new TextEncoder().encode(s)

function hashing() {
  const h = createHash("sha256")
  let size = 0
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      h.update(chunk)
      size += chunk.byteLength
      ctl.enqueue(chunk)
    },
  })
  return { stream, result: () => ({ size, sha256: h.digest("hex") }) }
}

export async function hashFile(p: string): Promise<{ size: number; sha256: string }> {
  const h = createHash("sha256")
  let size = 0
  for await (const chunk of createReadStream(p)) {
    h.update(chunk as Buffer)
    size += (chunk as Buffer).byteLength
  }
  return { size, sha256: h.digest("hex") }
}

export class ArchiveWriter {
  private files: ManifestFile[] = []
  private closed = false

  private constructor(
    private finalPath: string,
    private partialPath: string,
    private zip: ZipWriter<unknown>,
  ) {}

  /** Writes to `<finalPath>.partial`; finish() renames it into place. */
  static async create(finalPath: string, opts: { password?: string } = {}): Promise<ArchiveWriter> {
    await mkdir(path.dirname(finalPath), { recursive: true })
    const partialPath = finalPath + ".partial"
    const out = Writable.toWeb(createWriteStream(partialPath)) as WritableStream<Uint8Array>
    const zip = new ZipWriter(out, {
      zip64: true,
      level: 0,
      ...(opts.password ? { password: opts.password, encryptionStrength: 3 as const } : {}),
    })
    return new ArchiveWriter(finalPath, partialPath, zip)
  }

  async addFile(entry: string, src: string, opts: { compress?: boolean } = {}): Promise<ManifestFile> {
    const h = hashing()
    const input = (Readable.toWeb(createReadStream(src)) as ReadableStream<Uint8Array>).pipeThrough(h.stream)
    await this.zip.add(entry, input, { level: opts.compress ? 6 : 0 })
    const file = { path: entry, ...h.result() }
    this.files.push(file)
    return file
  }

  async addBytes(entry: string, data: string | Uint8Array, opts: { compress?: boolean } = { compress: true }): Promise<ManifestFile> {
    const bytes = typeof data === "string" ? encode(data) : data
    await this.zip.add(entry, new Uint8ArrayReader(bytes), { level: opts.compress ? 6 : 0 })
    const file = { path: entry, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }
    this.files.push(file)
    return file
  }

  async finish(meta: Omit<Manifest, "files">): Promise<{ path: string; manifest: Manifest }> {
    const manifest: Manifest = { ...meta, files: this.files }
    await this.zip.add(MANIFEST_ENTRY, new Uint8ArrayReader(encode(JSON.stringify(manifest, null, 2))), { level: 6 })
    await this.zip.close()
    this.closed = true
    await rename(this.partialPath, this.finalPath)
    return { path: this.finalPath, manifest }
  }

  /** For wrappers (the outer password zip): no manifest, just close and rename. */
  async closeWithoutManifest(): Promise<void> {
    await this.zip.close()
    this.closed = true
    await rename(this.partialPath, this.finalPath)
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      try {
        await this.zip.close()
      } catch {
        // already broken; the partial file goes either way
      }
    }
    await rm(this.partialPath, { force: true })
  }
}

/** zip.js needs random access; this reads straight from the file. */
class FileReader extends Reader<string> {
  private fh: FileHandle | null = null
  constructor(private p: string) {
    super(p)
  }
  async init() {
    this.fh = await open(this.p)
    this.size = (await this.fh.stat()).size
  }
  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    const b = Buffer.alloc(length)
    await this.fh!.read(b, 0, length, index)
    return new Uint8Array(b.buffer, b.byteOffset, length)
  }
  async closeFile() {
    await this.fh?.close()
    this.fh = null
  }
}

export class ArchiveReader {
  private constructor(
    private file: FileReader,
    private zip: ZipReader<unknown>,
    private byName: Map<string, FileEntry>,
  ) {}

  static async open(p: string, password?: string): Promise<ArchiveReader> {
    const file = new FileReader(p)
    const zip = new ZipReader(file, password ? { password } : {})
    try {
      const entries = await zip.getEntries()
      return new ArchiveReader(file, zip, new Map(entries.filter((e): e is FileEntry => !e.directory).map((e) => [e.filename, e])))
    } catch (e) {
      await file.closeFile()
      throw e
    }
  }

  entries(): string[] {
    return [...this.byName.keys()]
  }

  private entry(name: string): FileEntry {
    const e = this.byName.get(name)
    if (!e) throw new Error(`Not in archive: ${name}`)
    return e
  }

  async readText(name: string): Promise<string> {
    return this.entry(name).getData(new TextWriter())
  }

  async hash(name: string): Promise<{ size: number; sha256: string }> {
    const h = createHash("sha256")
    let size = 0
    await this.entry(name).getData(
      new WritableStream<Uint8Array>({
        write(chunk) {
          h.update(chunk)
          size += chunk.byteLength
        },
      }),
    )
    return { size, sha256: h.digest("hex") }
  }

  /** dest must already be a safe, caller-checked path. */
  async extract(name: string, dest: string): Promise<void> {
    await mkdir(path.dirname(dest), { recursive: true })
    await this.entry(name).getData(Writable.toWeb(createWriteStream(dest)) as WritableStream<Uint8Array>)
  }

  async manifest(): Promise<Manifest> {
    if (!this.byName.has(MANIFEST_ENTRY)) throw new Error("No manifest.json: not a HomeCenter archive.")
    return JSON.parse(await this.readText(MANIFEST_ENTRY)) as Manifest
  }

  async close(): Promise<void> {
    await this.zip.close()
    await this.file.closeFile()
  }
}
