# Meeting AI

Desktop app for live meeting and interview assistance. It captures system audio, transcribes speech in real time, and answers using your resume, notes, job description and knowledge files.

The desktop window is a transparent overlay that is hidden from screen sharing and recording. Show or hide it with Ctrl+Shift+Space (Cmd+Shift+Space on macOS).

## Install

Download Windows and macOS builds from the [Releases](https://github.com/khaled312001/Meeting-AI/releases/latest) page.

Builds are unsigned: on Windows choose **More info → Run anyway**; on macOS run `xattr -cr "/Applications/Meeting AI.app"` if it is reported as damaged.

## Features

- Live transcription of system audio (no virtual audio driver required on macOS)
- AI answers from transcript, typed questions, or screenshots
- **Compact mode** — picture-in-picture overlay with click-through; toolbar stays interactive while empty space passes clicks to apps behind
- **Backdrop slider** — Title bar **− / +** controls window transparency (full mode dims the whole UI; compact mode dims only the title bar and toolbar strip)
- Hidden from normal screen sharing (`contentProtection` + macOS sharing settings)
- In-app **Check for updates** (Title bar download icon); Homebrew and WinGet installs should use their package manager instead
- Keyboard shortcuts (see below)

### Keyboard shortcuts


| Action                         | macOS                               | Windows               |
| ------------------------------ | ----------------------------------- | --------------------- |
| Switch tab (full mode)         | ⌥C Assistant · ⌥A Ask AI · ⌥N Notes | Alt+C / A / N         |
| Generate Assistant answer        | ⌘Enter                              | Ctrl+Enter            |
| Summarize transcript           | ⌘⇧Enter                             | Ctrl+Shift+Enter      |
| Toggle Ask drawer (compact)    | ⌥A                                  | Alt+A                 |
| New Ask chat                   | ⌘⇧N                                 | Ctrl+Shift+N          |
| Push-to-talk mic (empty input) | Space (hold)                        | Space (hold)          |
| Attach screenshot              | ⌘⇧1 (global)                        | Ctrl+Shift+1 (global) |
| Cancel mic / close drawer      | Esc                                 | Esc                   |


On first launch, macOS may prompt for **Screen Recording** (system audio) and **Microphone** (Ask AI dictation). In compact mode, a small **Screen access** chip opens System Settings without blocking the overlay.

## Development

```bash
git clone https://github.com/khaled312001/Meeting-AI.git
cd meeting-ai
bun install
bun run electron:dev
```

Build installers with:

```bash
bun run electron:build
```

## Requirements

Node 22+ and Bun 1.3+
