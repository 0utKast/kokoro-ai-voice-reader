/**
 * Kokoro AI Voice Reader - Content Script
 * Text selection reader & article text extractor
 */

let floatingPillHost = null;
let currentSelectedText = "";

// 1. Create and manage the floating quick-action pill
function ensurePillElement() {
  if (!floatingPillHost) {
    floatingPillHost = document.createElement('div');
    floatingPillHost.id = 'kokoro-floating-pill-host';
    floatingPillHost.style.display = 'none';

    const pill = document.createElement('div');
    pill.className = 'kokoro-selection-pill';
    pill.innerHTML = `
      <span class="kokoro-pill-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        </svg>
      </span>
      <span class="kokoro-pill-label">Leer con Kokoro</span>
    `;

    pill.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    pill.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (currentSelectedText) {
        chrome.runtime.sendMessage({
          type: "PLAY_TEXT",
          text: currentSelectedText
        }).catch(() => {});
      }
      hidePill();
    });

    floatingPillHost.appendChild(pill);
    document.body.appendChild(floatingPillHost);
  }
  return floatingPillHost;
}

function showPill(x, y) {
  const host = ensurePillElement();
  const pill = host.querySelector('.kokoro-selection-pill');

  host.style.left = `${Math.max(10, x)}px`;
  host.style.top = `${Math.max(10, y)}px`;
  host.style.display = 'block';

  requestAnimationFrame(() => {
    pill.classList.add('visible');
  });
}

function hidePill() {
  if (floatingPillHost && floatingPillHost.style.display !== 'none') {
    const pill = floatingPillHost.querySelector('.kokoro-selection-pill');
    pill.classList.remove('visible');
    setTimeout(() => {
      floatingPillHost.style.display = 'none';
    }, 180);
  }
}

// 2. Event Listeners for Selection Detection
document.addEventListener('mouseup', (e) => {
  // If clicking on our own pill, ignore
  if (floatingPillHost && floatingPillHost.contains(e.target)) return;

  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text.length > 3) {
    currentSelectedText = text;
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      // Position pill centered above selection
      const pillX = rect.left + scrollX + (rect.width / 2) - 60;
      const pillY = rect.top + scrollY - 38;

      showPill(pillX, pillY);
    } catch {
      hidePill();
    }
  } else {
    hidePill();
  }
});

document.addEventListener('mousedown', (e) => {
  if (floatingPillHost && !floatingPillHost.contains(e.target)) {
    hidePill();
  }
});

// 3. Article & Front Page Text Extraction Helper
function extractMainArticleText() {
  const NOISE_REGEX = /(publicidad|anuncio|advertisement|patrocinad[oa]|contenido patrocinado|publi\b|sponsor|sponsored|hazte socio|hazte socia|socios y socias|suscr[ií]bete|suscripci[oó]n|inicia sesi[oó]n|reg[ií]strate|newsletter|bolet[ií]n|cookies|aviso legal|pol[ií]tica de privacidad|lo m[aá]s visto|lo m[aá]s le[ií]do|quiz[aá] te interese|te puede interesar|comentarios|ver comentarios|compartir|destacadas\b|actualidad\b|v[ií]deos\b|tremending|ventajas y experiencias|comunidad de p[uú]blico)/i;

  function cleanString(str) {
    return str ? str.replace(/\s+/g, " ").trim() : "";
  }

  function isBoilerplateNoise(text) {
    if (!text) return true;
    const t = cleanString(text);
    if (t.length < 25 && !/[.,:;!?¿¡]/.test(t)) return true; // Isolated short tags/categories without punctuation
    if (NOISE_REGEX.test(t)) return true;
    return false;
  }

  // =========================================================================
  // PRIORITY 1: READABILITY ENGINE (Articles, Wikipedia, Blogs, News Stories)
  // =========================================================================
  const ReadabilityClass = typeof Readability !== "undefined" ? Readability : globalThis.Readability;
  if (typeof ReadabilityClass === "function") {
    try {
      const docClone = document.cloneNode(true);
      docClone.querySelectorAll("script, style, noscript, nav, header, footer, aside, .advertisement, .ad, [aria-hidden=\"true\"], svg, button, form, .cookie-banner").forEach(el => el.remove());

      const reader = new ReadabilityClass(docClone);
      const article = reader.parse();

      if (article && article.content) {
        const title = cleanString(article.title);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = article.content;

        tempDiv.querySelectorAll(".ad, .advertisement, [class*=\"publicidad\"], [id*=\"publicidad\"]").forEach(el => el.remove());

        const pElements = Array.from(tempDiv.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote"));
        const validParagraphs = [];
        const seenBlocks = new Set();

        for (const el of pElements) {
          const txt = cleanString(el.textContent);
          if (isBoilerplateNoise(txt)) continue;
          if (txt.length < 25 && !/[.,:;!?¿¡]/.test(txt)) continue;
          const norm = txt.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, "");
          if (seenBlocks.has(norm)) continue;
          seenBlocks.add(norm);
          validParagraphs.push(txt);
        }

        // Require at least 2 good paragraphs or a solid body of text (>120 chars) to confirm it is an article
        const totalTextLength = validParagraphs.reduce((acc, p) => acc + p.length, 0);
        if (validParagraphs.length >= 2 || totalTextLength > 120) {
          const resultBlocks = [];
          if (title && !isBoilerplateNoise(title)) resultBlocks.push(title);
          if (article.byline) {
            const by = cleanString(article.byline);
            if (by && by.length < 100 && !isBoilerplateNoise(by)) resultBlocks.push(by);
          }
          resultBlocks.push(...validParagraphs);
          return resultBlocks.join("\n\n");
        }
      }
    } catch (readabilityErr) {
      console.warn("Readability article parse failed, trying fallback:", readabilityErr);
    }
  }

  // =========================================================================
  // PRIORITY 2: FRONT PAGE / PORTADA / FEED (Only if truly a homepage or aggregator)
  // =========================================================================
  const currentPath = window.location.pathname || "";
  const isHomePage = currentPath === "/" || currentPath === "" || currentPath.endsWith("/index.html") || currentPath.endsWith("/index.htm");
  const cardElements = Array.from(document.querySelectorAll("article, [class*=\"article\"], [class*=\"card\"], [class*=\"noticia\"], [data-mrf-link]"));

  if (isHomePage || cardElements.length >= 12) {
    const headlines = [];
    const seenHeadlines = new Set();

    if (cardElements.length > 0) {
      cardElements.forEach(card => {
        const heading = card.querySelector("h1, h2, h3, h4, h5, [class*=\"headline\"], [class*=\"title\"]");
        if (!heading) return;

        const titleTxt = cleanString(heading.textContent);
        if (titleTxt.length < 25 || isBoilerplateNoise(titleTxt)) return;

        const norm = titleTxt.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, "");
        if (seenHeadlines.has(norm)) return;
        seenHeadlines.add(norm);

        const leadP = card.querySelector("p:not([class*=\"author\"]):not([class*=\"firma\"]):not([class*=\"byline\"]):not([class*=\"date\"])");
        let leadTxt = "";
        if (leadP) {
          const pTxt = cleanString(leadP.textContent);
          const pNorm = pTxt.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, "");
          if (pTxt.length >= 28 && pTxt.length <= 350 && !isBoilerplateNoise(pTxt) && pNorm !== norm) {
            leadTxt = pTxt;
          }
        }

        if (leadTxt) {
          headlines.push(`${titleTxt}\n   ${leadTxt}`);
        } else {
          headlines.push(titleTxt);
        }
      });
    }

    if (headlines.length > 0) {
      const rawPageTitle = cleanString(document.title);
      const siteTitle = rawPageTitle.split(/[-|—·]/)[0].trim() || "Titulares de portada";
      const topHeadlines = headlines.slice(0, 30);
      return `${siteTitle} — Titulares destacados:\n\n` + topHeadlines.map((h, i) => `${i + 1}. ${h}`).join("\n\n");
    }
  }

  // =========================================================================
  // CASE 3: ULTIMATE FALLBACK
  // =========================================================================
  const main = document.querySelector("article, main, #content, .post-content, .mw-parser-output, [role=\"main\"]") || document.body;
  const clone = main.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, nav, header, footer, aside, .ad, [aria-hidden=\"true\"]").forEach(e => e.remove());
  const pTags = Array.from(clone.querySelectorAll("p, h1, h2, h3, li"));
  const fallbackBlocks = [];
  const seenFallback = new Set();
  pTags.forEach(el => {
    const txt = cleanString(el.textContent);
    if (!isBoilerplateNoise(txt) && txt.length >= 28) {
      const norm = txt.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, "");
      if (!seenFallback.has(norm)) {
        seenFallback.add(norm);
        fallbackBlocks.push(txt);
      }
    }
  });

  return fallbackBlocks.join("\n\n") || clone.innerText.trim();
}

// 4. Runtime Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'READ_SELECTION': {
      const selection = window.getSelection().toString().trim();
      sendResponse({ text: selection });
      break;
    }

    case 'EXTRACT_ARTICLE': {
      const sel = window.getSelection().toString().trim();
      const text = (sel && sel.length > 5) ? sel : extractMainArticleText();
      sendResponse({ text: text });
      break;
    }

    default:
      sendResponse({ received: true });
      break;
  }
  return true;
});
