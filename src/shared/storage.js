/**
 * Storage Helper for Kokoro AI Voice Reader
 */
import { DEFAULT_SETTINGS, KOKORO_VOICES } from './constants.js';

export async function getSettings() {
  try {
    const data = await chrome.storage.local.get('kokoro_settings');
    const settings = { ...DEFAULT_SETTINGS, ...(data.kokoro_settings || {}) };
    
    // Auto-heal voice setting if previously saved voice is no longer valid
    const validIds = KOKORO_VOICES.map(v => v.id);
    if (!validIds.includes(settings.selectedVoice)) {
      settings.selectedVoice = DEFAULT_SETTINGS.selectedVoice;
    }
    
    return settings;
  } catch (err) {
    console.error('Failed to load settings:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings) {
  try {
    const current = await getSettings();
    const updated = { ...current, ...settings };
    await chrome.storage.local.set({ kokoro_settings: updated });
    return updated;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return null;
  }
}

export async function getSessionState() {
  try {
    const data = await chrome.storage.session.get('kokoro_session');
    return data.kokoro_session || {
      isPlaying: false,
      isPaused: false,
      currentChunkIndex: 0,
      totalChunks: 0,
      text: ""
    };
  } catch {
    return { isPlaying: false, isPaused: false, currentChunkIndex: 0, totalChunks: 0, text: "" };
  }
}

export async function setSessionState(stateUpdate) {
  try {
    const current = await getSessionState();
    const next = { ...current, ...stateUpdate };
    await chrome.storage.session.set({ kokoro_session: next });
    return next;
  } catch (err) {
    console.error('Failed to update session state:', err);
  }
}
