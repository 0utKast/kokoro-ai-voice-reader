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

// 3. Article Text Extraction Helper
function extractMainArticleText() {
  // Try finding semantic article or main containers
  const candidates = [
    document.querySelector('article'),
    document.querySelector('[role="article"]'),
    document.querySelector('main'),
    document.querySelector('#content'),
    document.querySelector('.post-content'),
    document.querySelector('.article-body')
  ].filter(Boolean);

  let targetElement = candidates[0];

  // If no semantic article found, find container with the highest paragraph text density
  if (!targetElement) {
    const paragraphs = Array.from(document.querySelectorAll('p'));
    if (paragraphs.length > 0) {
      const parentCounts = new Map();
      paragraphs.forEach(p => {
        const parent = p.parentElement;
        if (parent) {
          parentCounts.set(parent, (parentCounts.get(parent) || 0) + p.textContent.length);
        }
      });

      let maxParent = document.body;
      let maxLen = 0;
      parentCounts.forEach((len, parent) => {
        if (len > maxLen) {
          maxLen = len;
          maxParent = parent;
        }
      });
      targetElement = maxParent;
    } else {
      targetElement = document.body;
    }
  }

  // Clone node to clean without affecting live DOM
  const clone = targetElement.cloneNode(true);
  const elementsToRemove = clone.querySelectorAll(
    'script, style, noscript, nav, header, footer, aside, .advertisement, .ad, [aria-hidden="true"]'
  );
  elementsToRemove.forEach(el => el.remove());

  return clone.innerText.trim();
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
      const text = extractMainArticleText();
      sendResponse({ text: text });
      break;
    }

    default:
      sendResponse({ received: true });
      break;
  }
  return true;
});
