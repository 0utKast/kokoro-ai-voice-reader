/**
 * Kokoro AI Voice Reader - PDF Text Extractor
 * Uses bundled Mozilla PDF.js to extract text from PDF ArrayBuffers / Blobs
 */

import * as pdfjsLib from '../libs/pdf.min.mjs';
import { normalizeTextForSpeech } from './audio-utils.js';

// Configure Web Worker path for PDF.js inside Chrome Extension
if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/libs/pdf.worker.min.mjs');
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
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const lines = [];
      let currentLine = '';
      let lastY = null;
      let lineSpacings = [];

      for (const item of textContent.items) {
        if (!item.str) continue;

        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
          const dy = Math.abs(y - lastY);
          lineSpacings.push(dy);
          if (currentLine.trim()) {
            lines.push({ text: currentLine.trim(), dy: dy });
          }
          currentLine = item.str;
        } else {
          currentLine += (currentLine ? ' ' : '') + item.str;
        }
        lastY = y;
      }

      if (currentLine.trim()) {
        lines.push({ text: currentLine.trim(), dy: 12 });
      }

      // Calculate median line spacing to distinguish normal line wraps from paragraph gaps
      const sortedSpacings = [...lineSpacings].sort((a, b) => a - b);
      const medianSpacing = sortedSpacings.length > 0 
        ? sortedSpacings[Math.floor(sortedSpacings.length / 2)] 
        : 12;

      let pageParagraphs = [];
      let currentPara = '';

      for (let i = 0; i < lines.length; i++) {
        const { text, dy } = lines[i];
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

      const pageText = pageParagraphs.join('\n\n');
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

  const rawExtracted = pageTexts.join('\n\n');
  return normalizeTextForSpeech(rawExtracted);
}
