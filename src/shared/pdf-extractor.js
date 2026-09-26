/**
 * Kokoro AI Voice Reader - PDF Text Extractor
 * Uses bundled Mozilla PDF.js to extract text from PDF ArrayBuffers / Blobs
 */

import * as pdfjsLib from '../libs/pdf.min.mjs';

// Configure Web Worker path for PDF.js inside Chrome Extension
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/libs/pdf.worker.min.mjs');
}

/**
 * Extracts plain text from a PDF ArrayBuffer
 * @param {ArrayBuffer} arrayBuffer 
 * @param {Function} [onProgress] - Optional progress callback (page, totalPages)
 * @returns {Promise<string>} Clean extracted text
 */
export async function extractTextFromPDF(arrayBuffer, onProgress = null) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageLines = [];
      let currentLine = '';
      let lastY = null;

      for (const item of textContent.items) {
        if (!item.str) continue;

        // Detect new lines based on Y coordinate change
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 8) {
          if (currentLine.trim()) {
            pageLines.push(currentLine.trim());
          }
          currentLine = item.str;
        } else {
          currentLine += (currentLine ? ' ' : '') + item.str;
        }
        lastY = y;
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim());
      }

      const pageText = pageLines.join('\n');
      if (pageText.trim()) {
        pageTexts.push(pageText.trim());
      }

      if (onProgress) {
        onProgress(pageNum, numPages);
      }
    } catch (pageErr) {
      console.warn(`Error extracting text from PDF page ${pageNum}:`, pageErr);
    }
  }

  return pageTexts.join('\n\n');
}
