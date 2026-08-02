import type { LoadedAttachment } from './types';

/** Extract text from a PDF for providers that cannot take native PDF parts (e.g. Ollama). */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  // Imported lazily so the pdf.js bundle is only paid for when a PDF is actually used.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const document = await getDocumentProxy(data);
  const { text } = await extractText(document, { mergePages: true });
  return text;
}

/** Pre-extract every PDF attachment, keyed by attachment id. Failures degrade to a note. */
export async function extractPdfAttachments(
  attachments: LoadedAttachment[],
): Promise<Map<string, string>> {
  const extracted = new Map<string, string>();
  for (const loaded of attachments) {
    if (loaded.attachment.kind !== 'pdf') continue;
    try {
      extracted.set(loaded.attachment.id, await extractPdfText(loaded.data));
    } catch (error) {
      extracted.set(loaded.attachment.id, `(PDF text extraction failed: ${String(error)})`);
    }
  }
  return extracted;
}
