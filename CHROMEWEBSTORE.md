# Chrome Web Store Listing — Kokoro AI Voice Reader

> Last Updated: 2026-09-26

## Store Listing

**Extension Name** [REQUIRED]
Kokoro AI Voice Reader — Local WebGPU Text-to-Speech

**Short Description** [REQUIRED]
Listen to any article or selected text with ultra-natural AI voices powered directly by your graphics card in 100% privacy.

**Detailed Description** [REQUIRED]
Kokoro AI Voice Reader transforms any webpage, news article, or document into lifelike speech using the next-generation Kokoro-82M neural model. 

Unlike traditional browser readers or cloud-based text-to-speech services that send your personal browsing history to remote servers, Kokoro runs entirely on your device. Powered by cutting-edge WebGPU hardware acceleration, your text is synthesized locally with zero lag, zero cloud subscriptions, and total privacy.

Key Features:
- Ultra-Natural Neural Voices: Enjoy rich, human-like narration in Spanish and English with remarkable clarity and natural rhythm.
- 100% Private and Offline: Speech synthesis happens entirely inside your browser. No personal data, articles, or text ever leave your computer.
- WebGPU Accelerated: Leverages your local graphics hardware for near-instant speech generation with smooth, continuous playback.
- Synchronized Karaoke Reading: Follow along with highlighted sentences and phrases as they are spoken, making reading and studying effortless.
- Permanent Side Panel: Read articles comfortably without popup windows closing when you click away.
- One-Click Article Capture: Automatically extract and listen to clean article content from news sites and blogs without clutter.
- Text Selection Quick-Reader: Highlight any paragraph or snippet on any website to hear it spoken immediately.
- Audio Export: Download synthesized speech as high-quality WAV audio files for offline listening or study.

How to Use:
1. Open the Kokoro side panel from the extension toolbar or press Alt+Shift+S (Option+Shift+S on Mac).
2. Click "Capture Page Article" or highlight any text on a webpage.
3. Choose your preferred voice and playback speed.
4. Press Play and enjoy uninterrupted, private listening with synchronized text highlighting.

Privacy & Security:
Kokoro AI Voice Reader does not collect, transmit, or monetize any user data. All neural model computations occur on your local GPU through WebGPU. No account or API keys required.

**Category** [REQUIRED]
Accessibility

**Single Purpose** [REQUIRED]
Converts web text and selected passages into human-like speech offline using local WebGPU acceleration.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ⬜ Not created | screenshots/screenshot-1.png |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ⬜ Not created | screenshots/screenshot-2.png |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ⬜ Not created | screenshots/screenshot-3.png |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | promo/tile-small.png |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | promo/marquee.png |

### Screenshot Notes
- Screenshot 1: Side panel interface active next to a clean news article with Karaoke highlighting in action.
- Screenshot 2: Voice selector showing Spanish and English neural voices with WebGPU status indicator.
- Screenshot 3: Context menu and quick-action selection pill reading text on a webpage.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | Provides a persistent, non-intrusive side panel interface where users control playback, adjust speech settings, and follow karaoke text while browsing. |
| `offscreen` | permissions | Creates a background offscreen document required to access the WebGPU and Web Audio APIs for local neural model inference and continuous audio playback. |
| `storage` | permissions | Saves user preferences locally, including selected voice, playback speed, volume, and speech history. |
| `activeTab` | permissions | Allows the extension to extract the text content of the currently active article when the user explicitly requests to listen to the page. |
| `contextMenus` | permissions | Adds an option to the right-click menu so users can instantly read any highlighted text selection. |
| `scripting` | permissions | Injects the content script helper to extract clean article text and highlight sentences on the webpage when requested by the user. |

---

## Privacy & Data Use

### Data Collection
**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Distribution
**Visibility**: Public  
**Regions**: All regions

## Developer Info
**Publisher Name** [REQUIRED]: 0utKast  
**Contact Email** [REQUIRED]: outkast@local.dev  
**Support URL**: https://github.com/0utKast/kokoro-ai-voice-reader/issues  
**Homepage URL**: https://github.com/0utKast/kokoro-ai-voice-reader

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.1.0 | 2026-09-27 | Added integrated PDF reader (local and tab-based), pure JS MP3 audio compression (LameJS, 82% smaller), and decoupled real-time WebGPU synthesis progress tracking. | Ready for Submission |
| 1.0.0 | 2026-09-26 | Initial release: Manifest V3 with WebGPU Kokoro-82M offline engine, Side Panel UI, and Karaoke mode. | Draft |
