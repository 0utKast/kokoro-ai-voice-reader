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

  // --- Step 1: Check if page is an Article via Mozilla Readability ---
  const ReadabilityClass = typeof Readability !== "undefined" ? Readability : globalThis.Readability;
  if (typeof ReadabilityClass === "function") {
    try {
      const docClone = document.cloneNode(true);
      // Remove known noisy elements before Readability parses
      docClone.querySelectorAll("script, style, noscript, nav, header, footer, aside, .advertisement, .ad, [aria-hidden=\"true\"], svg, button, form, .cookie-banner").forEach(el => el.remove());

      const reader = new ReadabilityClass(docClone);
      const article = reader.parse();

      if (article && article.content) {
        const title = cleanString(article.title);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = article.content;

        // Clean out any nested ads or noise inside the parsed article
        tempDiv.querySelectorAll(".ad, .advertisement, [class*=\"publicidad\"], [id*=\"publicidad\"]").forEach(el => el.remove());

        const pElements = Array.from(tempDiv.querySelectorAll("p, blockquote"));
        const validParagraphs = [];
        const seenBlocks = new Set();

        for (const p of pElements) {
          const txt = cleanString(p.textContent);
          if (isBoilerplateNoise(txt)) continue;
          if (txt.length < 35 && !/[.,:;!?¿¡]/.test(txt)) continue;
          const norm = txt.toLowerCase();
          if (seenBlocks.has(norm)) continue;
          seenBlocks.add(norm);
          validParagraphs.push(txt);
        }

        // A true article has at least 2 real paragraphs or 1 substantial paragraph (>= 180 chars)
        const isTrueArticle = validParagraphs.length >= 2 || (validParagraphs.length === 1 && validParagraphs[0].length >= 180);
        if (isTrueArticle) {
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
      console.warn("Readability article parse failed, trying front page extractor:", readabilityErr);
    }
  }

  // --- Step 2: Front Page / News Portal / Headline Extractor ---
  // If we reach here, the page is a Home page (portada), category index, or news aggregator
  const headlines = [];
  const seenHeadlines = new Set();

  // Find candidate headline containers (article cards, headings with links)
  const cardElements = document.querySelectorAll("article, [class*=\"article\"], [class*=\"card\"], [class*=\"noticia\"], [data-mrf-link]");
  
  if (cardElements.length > 0) {
    cardElements.forEach(card => {
      const heading = card.querySelector("h1, h2, h3, h4, [class*=\"headline\"], [class*=\"title\"]");
      if (!heading) return;

      const titleTxt = cleanString(heading.textContent);
      if (titleTxt.length < 25 || isBoilerplateNoise(titleTxt)) return;

      const norm = titleTxt.toLowerCase();
      if (seenHeadlines.has(norm)) return;
      seenHeadlines.add(norm);

      // Check if there is an accompanying summary / lead paragraph in this card
      const leadP = card.querySelector("p");
      let leadTxt = "";
      if (leadP) {
        const pTxt = cleanString(leadP.textContent);
        if (pTxt.length >= 35 && pTxt.length <= 300 && !isBoilerplateNoise(pTxt) && pTxt.toLowerCase() !== norm) {
          leadTxt = pTxt;
        }
      }

      if (leadTxt) {
        headlines.push(`${titleTxt}\n${leadTxt}`);
      } else {
        headlines.push(titleTxt);
      }
    });
  }

  // If card elements didn not yield enough, try all standalone headings with links
  if (headlines.length < 3) {
    const headingLinks = document.querySelectorAll("h1 a, h2 a, h3 a, h2, h3");
    headingLinks.forEach(h => {
      const txt = cleanString(h.textContent);
      if (txt.length < 25 || isBoilerplateNoise(txt)) return;
      const norm = txt.toLowerCase();
      if (seenHeadlines.has(norm)) return;
      seenHeadlines.add(norm);
      headlines.push(txt);
    });
  }

  if (headlines.length > 0) {
    const rawPageTitle = cleanString(document.title);
    const siteTitle = rawPageTitle.split(/[-|—]/)[0].trim() || "Titulares de portada";
    return `${siteTitle} — Titulares destacados:\n\n` + headlines.map((h, i) => `${i + 1}. ${h}`).join("\n\n");
  }

  // --- Step 3: Ultimate Fallback for Other Web Pages ---
  const main = document.querySelector("main, #content, [role=\"main\"]") || document.body;
  const clone = main.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, nav, header, footer, aside, .ad, [aria-hidden=\"true\"]").forEach(e => e.remove());
  const pTags = Array.from(clone.querySelectorAll("p, h1, h2, h3, li"));
  const fallbackBlocks = [];
  const seenFallback = new Set();
  pTags.forEach(el => {
    const txt = cleanString(el.textContent);
    if (!isBoilerplateNoise(txt) && txt.length >= 30) {
      const norm = txt.toLowerCase();
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
