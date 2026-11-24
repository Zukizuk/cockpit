// Reads one Office file in a worker thread, so a big workbook never holds up the server (and every other card).
// Gets { format, file } and posts back the preview, or { error, user } when it can't.
import { parentPort, workerData } from 'node:worker_threads'
import { UserError } from './config.js'
import { docxToHtml, pptxSlides, readSheets } from './office-parse.js'

const { format, file } = workerData
try {
  const out =
    format === 'docx' ? { html: await docxToHtml(file) } : format === 'sheet' ? { sheets: await readSheets(file) } : { slides: await pptxSlides(file) }
  parentPort.postMessage(out)
} catch (e) {
  parentPort.postMessage({ error: e?.message || String(e), user: e instanceof UserError })
}
