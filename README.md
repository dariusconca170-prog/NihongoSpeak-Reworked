# NihongoSpeak

A Japanese language tutor desktop app using Electron + Node.js with AI-powered conversations, voice input/output, and vocabulary tracking.

## Quick Start

1. **Double-click `setup.bat`** to install all dependencies
2. **Double-click `run.bat`** to start the app

## Troubleshooting

**Mic not recording:** Install SoX from https://sox.sourceforge.net/

**TTS not working:** Reinstall edge-tts: `npm install -g edge-tts`

**Can't get API key:** Visit https://console.groq.com (free tier available)

## Project Structure

```
NihongoSpeak/
├── main.js          # Electron main process
├── renderer/       # UI files
│   ├── index.html
│   ├── app.js
│   └── style.css
├── resources/      # System prompts
├── src/           # Helper scripts
├── setup.bat      # First-time setup
└── run.bat       # Run the app
```