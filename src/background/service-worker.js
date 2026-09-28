/**
 * Kokoro AI Voice Reader - Background Service Worker
 * Manifest V3 Compliant: Orchestrator, Context Menus, Keyboard Shortcuts, and Offscreen Management
 */

import { MESSAGE_TYPES } from '../shared/constants.js';
import { getSettings, setSessionState } from '../shared/storage.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

// 1. Extension Lifecycle: Setup Context Menus and Side Panel Behavior
chrome.runtime.onInstalled.addListener(async () => {
  // Set Side Panel behavior: Opens automatically when clicking the extension action icon
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (err) {
      console.warn('sidePanel.setPanelBehavior error:', err);
    }
  }

  // Create Context Menu for reading selections
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'kokoro-read-selection',
      title: '🔊 Leer selección con Kokoro AI',
      contexts: ['selection']
    });
  });
});

// 2. Ensure Offscreen Document Exists (Protected by State Locking)
let isCreatingOffscreen = false;

async function ensureOffscreenDocument() {
  if (isCreatingOffscreen) {
    while (isCreatingOffscreen) {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  }

  isCreatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK', 'WORKERS'],
      justification: 'Inferencia de Kokoro-82M con WebGPU y streaming continuo de Web Audio'
    });
  } catch (err) {
    if (!err.message?.includes('Only a single offscreen document may be created')) {
      console.error('Error creating offscreen document:', err);
    }
  } finally {
    isCreatingOffscreen = false;
  }
}

async function waitForOffscreenReady(maxRetries = 25) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CHECK_ENGINE });
      if (res?.ready) return true;
    } catch {
      // Offscreen engine still initializing
    }
    await new Promise(r => setTimeout(r, 60));
  }
  return false;
}

// Unified handler for reading selected text (from context menu, keyboard shortcut, or floating pill)
async function playSelectedText(rawText, tabId = null) {
  const text = rawText ? rawText.trim() : '';
  if (!text) return;

  await ensureOffscreenDocument();
  await waitForOffscreenReady();
  const settings = await getSettings();

  // Open side panel if enabled and tabId is present
  if (settings.autoOpenSidePanel !== false && chrome.sidePanel && tabId) {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (err) {
      console.warn('Could not auto-open side panel:', err);
    }
  }

  // Send text to side panel input if open
  chrome.runtime.sendMessage({
    type: 'SELECTION_TEXT_LOADED',
    text: text
  }).catch(() => {});

  await setSessionState({ isPlaying: true, isPaused: false, text: text });

  // Dispatch to offscreen engine with configured voice and speed
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PLAY_TEXT,
    text: text,
    voice: settings.selectedVoice,
    speed: settings.speed,
    volume: settings.volume,
    origin: 'service_worker'
  }).catch((err) => {
    console.error('Error dispatching PLAY_TEXT to offscreen:', err);
  });
}

// 3. Handle Context Menu Click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'kokoro-read-selection' && info.selectionText) {
    await playSelectedText(info.selectionText, tab?.id);
  }
});

// 4. Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'read-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.READ_SELECTION });
      if (response?.text) {
        await playSelectedText(response.text, tab.id);
      }
    } catch (err) {
      console.warn('Keyboard command handler error:', err);
    }
  } else if (command === 'stop-playback') {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_PLAYBACK }).catch(() => {});
  }
});

// 5. Service Worker Message Listener (Lifecycle & State tracking only, NO RE-BROADCASTING!)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If message originated from service worker itself, ignore to prevent loops
  if (message.origin === 'service_worker') {
    return false;
  }

  (async () => {
    try {
      switch (message.type) {
        case 'ENSURE_OFFSCREEN': {
          await ensureOffscreenDocument();
          await waitForOffscreenReady();
          sendResponse({ success: true });
          break;
        }

        case 'PLAY_SELECTION': {
          await playSelectedText(message.text, sender?.tab?.id);
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.PLAY_TEXT: {
          // If sent from a content script, route through playSelectedText to ensure offscreen and load settings
          if (sender?.tab?.id && message.origin !== 'sidepanel') {
            await playSelectedText(message.text, sender.tab.id);
            sendResponse({ success: true, handledByServiceWorker: true });
            break;
          }
          await ensureOffscreenDocument();
          await setSessionState({ isPlaying: true, isPaused: false, text: message.text });
          sendResponse({ success: true, handledByServiceWorker: true });
          break;
        }

        case MESSAGE_TYPES.STOP_PLAYBACK: {
          await setSessionState({ isPlaying: false, isPaused: false });
          sendResponse({ success: true });
          break;
        }

        default:
          // Do not sendResponse here to avoid conflict with offscreen handler
          break;
      }
    } catch (err) {
      console.error('Service worker error:', err);
      sendResponse({ error: err.message });
    }
  })();

  // Return true if we are handling the response asynchronously for our specific messages
  if (message.type === 'ENSURE_OFFSCREEN' || message.type === 'PLAY_SELECTION' || message.type === MESSAGE_TYPES.PLAY_TEXT) {
    return true;
  }
  return false;
});
