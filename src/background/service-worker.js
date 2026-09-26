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
    // Wait briefly if creation is currently underway
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
    // If document already exists or concurrent call succeeded, ignore
    if (!err.message?.includes('Only a single offscreen document may be created')) {
      console.error('Error creating offscreen document:', err);
    }
  } finally {
    isCreatingOffscreen = false;
  }
}

// 3. Handle Context Menu Click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'kokoro-read-selection' && info.selectionText) {
    const text = info.selectionText.trim();
    if (!text) return;

    await ensureOffscreenDocument();
    const settings = await getSettings();

    // Open side panel if supported
    if (chrome.sidePanel && tab?.id) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch (err) {
        console.warn('Could not auto-open side panel:', err);
      }
    }

    // Forward text to offscreen document
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PLAY_TEXT,
      text: text,
      voice: settings.selectedVoice,
      speed: settings.speed,
      volume: settings.volume
    });
  }
});

// 4. Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'read-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      // Ask content script for current selection
      const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.READ_SELECTION });
      if (response?.text) {
        await ensureOffscreenDocument();
        const settings = await getSettings();
        await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.PLAY_TEXT,
          text: response.text,
          voice: settings.selectedVoice,
          speed: settings.speed,
          volume: settings.volume
        });
      }
    } catch (err) {
      console.warn('Keyboard command handler error:', err);
    }
  } else if (command === 'stop-playback') {
    await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_PLAYBACK }).catch(() => {});
  }
});

// 5. Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.CHECK_ENGINE: {
          await ensureOffscreenDocument();
          sendResponse({ success: true, ready: true });
          break;
        }

        case MESSAGE_TYPES.PLAY_TEXT: {
          await ensureOffscreenDocument();
          await setSessionState({ isPlaying: true, isPaused: false, text: message.text });
          // Forward to offscreen
          const res = await chrome.runtime.sendMessage(message);
          sendResponse(res || { success: true });
          break;
        }

        case MESSAGE_TYPES.STOP_PLAYBACK: {
          await setSessionState({ isPlaying: false, isPaused: false });
          const res = await chrome.runtime.sendMessage(message).catch(() => {});
          sendResponse(res || { success: true });
          break;
        }

        case MESSAGE_TYPES.PAUSE_PLAYBACK:
        case MESSAGE_TYPES.RESUME_PLAYBACK: {
          const res = await chrome.runtime.sendMessage(message).catch(() => {});
          sendResponse(res || { success: true });
          break;
        }

        default:
          // Allow unhandled messages to pass through to UI or Offscreen
          sendResponse({ received: true });
          break;
      }
    } catch (err) {
      console.error('Service worker message routing error:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
