import { ExtractError } from "../types"

// Email and legacy binary formats. Each parser reads untrusted bytes, so any
// failure becomes a fixed-phrase ExtractError (never parser output).

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
}

function messageText(m: { subject?: string; from?: string; to?: string; attachments?: string[]; body?: string }): string {
  const lines = [
    m.subject ? `Subject: ${m.subject}` : "",
    m.from ? `From: ${m.from}` : "",
    m.to ? `To: ${m.to}` : "",
    m.attachments?.length ? `Attachments: ${m.attachments.join(", ")}` : "",
    "",
    m.body ?? "",
  ]
  return lines.join("\n").trim()
}

export async function extractEml(data: Buffer): Promise<string[]> {
  const { default: PostalMime } = await import("postal-mime")
  try {
    const mail = await PostalMime.parse(data)
    const who = (a?: { name?: string; address?: string }[]) =>
      (a ?? []).map((x) => (x.name ? `${x.name} <${x.address ?? ""}>` : (x.address ?? ""))).join(", ")
    return [messageText({
      subject: mail.subject,
      from: mail.from ? who([mail.from]) : undefined,
      to: who(mail.to),
      attachments: mail.attachments?.map((a) => a.filename ?? "").filter(Boolean),
      body: mail.text ?? (mail.html ? htmlToText(mail.html) : ""),
    })]
  } catch {
    throw new ExtractError("Not a readable email")
  }
}

export async function extractMsg(data: Buffer): Promise<string[]> {
  const { default: MsgReader } = await import("@kenjiuno/msgreader")
  try {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const msg = new MsgReader(buf).getFileData()
    if (msg.error) throw new Error("bad msg")
    return [messageText({
      subject: msg.subject,
      from: msg.senderName ? `${msg.senderName}${msg.senderEmail ? ` <${msg.senderEmail}>` : ""}` : msg.senderEmail,
      to: msg.recipients?.map((r) => (r.name ? `${r.name}${r.email ? ` <${r.email}>` : ""}` : (r.email ?? ""))).filter(Boolean).join(", "),
      attachments: msg.attachments?.map((a) => a.fileName ?? a.fileNameShort ?? "").filter(Boolean),
      body: msg.body || (msg.bodyHtml ? htmlToText(msg.bodyHtml) : ""),
    })]
  } catch {
    throw new ExtractError("Not a readable Outlook message")
  }
}

/** Every sheet of an old .xls (or macro-enabled .xlsm) as tab-separated rows, one page per sheet. */
export async function extractSheet(data: Buffer): Promise<string[]> {
  const XLSX = await import("@e965/xlsx")
  try {
    // SheetJS reads anything it can't place as CSV; only accept real containers (OLE2 for .xls, zip for .xlsm).
    const ole = data.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
    const zip = data.subarray(0, 2).toString("latin1") === "PK"
    if (!ole && !zip) throw new Error("not a workbook")
    const wb = XLSX.read(data, { type: "buffer" })
    return wb.SheetNames.map((name) => `${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: "\t" })}`)
  } catch {
    throw new ExtractError("Not a readable spreadsheet")
  }
}

const TEXT_CHARS = 4000 // UTF-16LE
const TEXT_BYTES = 4008 // Latin-1

/** Text runs from the PowerPoint Document stream of an old .ppt: walk the record tree, keep the text atoms. */
export async function extractPpt(data: Buffer): Promise<string[]> {
  const XLSX = await import("@e965/xlsx")
  try {
    const cfb = XLSX.CFB.read(data, { type: "buffer" })
    const entry = XLSX.CFB.find(cfb, "PowerPoint Document")
    if (!entry?.content) throw new Error("no stream")
    const s = Buffer.from(entry.content as Uint8Array)
    const out: string[] = []
    const walk = (start: number, end: number) => {
      let p = start
      while (p + 8 <= end) {
        const verInst = s.readUInt16LE(p)
        const type = s.readUInt16LE(p + 2)
        const len = s.readUInt32LE(p + 4)
        const body = p + 8
        if (body + len > end) break
        if ((verInst & 0xf) === 0xf) walk(body, body + len)
        else if (type === TEXT_CHARS) out.push(s.toString("utf16le", body, body + len))
        else if (type === TEXT_BYTES) out.push(s.toString("latin1", body, body + len))
        p = body + len
      }
    }
    walk(0, s.length)
    return [out.map((t) => t.replace(/\r/g, "\n").trim()).filter(Boolean).join("\n\n")]
  } catch {
    throw new ExtractError("Not a readable presentation")
  }
}
