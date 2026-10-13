/**
 * Kokoro AI Voice Reader - PDF Text Extractor
 * Uses bundled Mozilla PDF.js to extract text from PDF ArrayBuffers / Blobs
 */

import * as pdfjsLib from '../libs/pdf.min.mjs';
import { normalizeTextForSpeech } from './audio-utils.js';

// Configure Web Worker path for PDF.js inside Chrome Extension or Web/PWA
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/libs/pdf.worker.min.mjs');
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../libs/pdf.worker.min.mjs', import.meta.url).href;
}

/**
 * Extracts plain text from a PDF ArrayBuffer
 * @param {ArrayBuffer} arrayBuffer 
 * @param {Function} [onProgress] - Optional progress callback (page, totalPages)
 * @returns {Promise<string>} Clean, normalized prose text with continuous paragraphs
 */
export async function extractTextFromPDF(arrayBuffer, onProgress = null) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    isEvalSupported: false
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const pageParagraphLists = [];
  const ISOLATED_PAGE_NUM_RE = /^(?:(?:p[aá]g(?:ina)?\.?|page)\s*)?\d{1,4}(?:\s*(?:\/|-|de|of)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      let page = null;
      try {
        page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        const rawLines = [];
        let currentLine = '';
        let lastY = null;
        const lineSpacings = [];

        for (const item of textContent.items) {
          if (!item.str) continue;

          const y = item.transform ? item.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
            const dy = Math.abs(y - lastY);
            lineSpacings.push(dy);
            if (currentLine.trim()) {
              rawLines.push({ text: currentLine.trim(), dy: dy });
            }
            currentLine = item.str;
          } else {
            currentLine += (currentLine ? ' ' : '') + item.str;
          }
          lastY = y;
        }

        if (currentLine.trim()) {
          rawLines.push({ text: currentLine.trim(), dy: 12 });
        }

        // Strip isolated header/footer page numbers at the very top or bottom of a page
        if (rawLines.length > 1 && ISOLATED_PAGE_NUM_RE.test(rawLines[0].text)) {
          rawLines.shift();
        }
        if (rawLines.length > 1 && ISOLATED_PAGE_NUM_RE.test(rawLines[rawLines.length - 1].text)) {
          rawLines.pop();
        }

        // Calculate median line spacing to distinguish normal line wraps from paragraph gaps
        const sortedSpacings = [...lineSpacings].sort((a, b) => a - b);
        const medianSpacing = sortedSpacings.length > 0
          ? sortedSpacings[Math.floor(sortedSpacings.length / 2)]
          : 12;

        const pageParagraphs = [];
        let currentPara = '';

        for (let i = 0; i < rawLines.length; i++) {
          const { text, dy } = rawLines[i];
          if (!text) continue;

          // Paragraph break if vertical gap is noticeably greater than median line height
          const isParaGap = dy > (medianSpacing * 1.55);

          if (!currentPara) {
            currentPara = text;
          } else if (isParaGap) {
            pageParagraphs.push(currentPara.trim());
            currentPara = text;
          } else {
            // Join lines within the same paragraph
            if (currentPara.endsWith('-')) {
              // De-hyphenate word broken across line end
              currentPara = currentPara.slice(0, -1) + text;
            } else {
              currentPara += ' ' + text;
            }
          }
        }

        if (currentPara.trim()) {
          pageParagraphs.push(currentPara.trim());
        }

        if (pageParagraphs.length > 0) {
          pageParagraphLists.push(pageParagraphs);
        }

        if (onProgress) {
          onProgress(pageNum, numPages);
        }
      } catch (pageErr) {
        console.warn(`Error extracting text from PDF page ${pageNum}:`, pageErr);
      } finally {
        try {
          if (page && typeof page.cleanup === 'function') {
            page.cleanup();
          }
        } catch {}
      }
    }
  } finally {
    try {
      await pdf.destroy();
    } catch {}
  }

  // Stitch paragraphs across page boundaries when a sentence continues onto the next page
  const mergedParagraphs = [];
  for (const pageParas of pageParagraphLists) {
    for (let i = 0; i < pageParas.length; i++) {
      const para = pageParas[i];
      if (i === 0 && mergedParagraphs.length > 0) {
        const prevPara = mergedParagraphs[mergedParagraphs.length - 1];
        const prevEndsIncomplete = !/[.!?…:;"»”)\]]$/.test(prevPara);
        const nextStartsContinuation = /^[\p{Ll},;)]/u.test(para);
        if (prevPara.endsWith('-')) {
          mergedParagraphs[mergedParagraphs.length - 1] = prevPara.slice(0, -1) + para;
          continue;
        } else if (prevEndsIncomplete && nextStartsContinuation) {
          mergedParagraphs[mergedParagraphs.length - 1] = prevPara + ' ' + para;
          continue;
        }
      }
      mergedParagraphs.push(para);
    }
  }

  const rawExtracted = mergedParagraphs.join('\n\n');
  return normalizeTextForSpeech(rawExtracted);
}
