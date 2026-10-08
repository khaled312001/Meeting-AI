# Meeting AI

Desktop app for live meeting and interview assistance. It captures system audio, transcribes speech in real time, and answers using your resume, notes, job description and knowledge files.

The desktop window is a transparent overlay that is hidden from screen sharing and recording. Show or hide it with Ctrl+Shift+Space (Cmd+Shift+Space on macOS).

## Install

Download Windows and macOS builds from the [Releases](https://github.com/khaled312001/Meeting-AI/releases/latest) page.

Builds are unsigned: on Windows choose **More info → Run anyway**; on macOS run `xattr -cr "/Applications/Meeting AI.app"` if it is reported as damaged.

## Features

- Live transcription of the meeting (system audio, no virtual audio driver required on macOS) and, optionally, your own microphone — each line is labeled **Interviewer** or **Me**
- **Meeting language** switch (العربية / English / Deutsch): listening and answers stay in that one language
- **Auto or Manual answers**: Auto waits until the question is finished, then answers it completely and word for word; if the speaker keeps going, the answer is redone for the whole question. Manual answers only when you press **Answer**
- **Notes on your own answer**: in Auto mode, once you finish answering aloud, wrong or missing points are flagged with a sentence to add
- Answers remember earlier questions and answers in the meeting, so follow-ups stay consistent, and use only your resume, notes and knowledge files for facts about you
- AI answers from transcript, typed questions, or screenshots
- **Focus mode** — floating glass bar (Answer · Screenshot · Chat · language · Auto/Manual · End) with the answer panel underneath; click-through overlay so empty space passes clicks to apps behind
- **Backdrop slider** — Title bar **− / +** controls window transparency in the full view
- Hidden from normal screen sharing (`contentProtection` + macOS sharing settings)
- In-app **Check for updates** (Title bar download icon); Homebrew and WinGet installs should use their package manager instead
- Keyboard shortcuts (see below)

### Keyboard shortcuts


| Action                         | macOS                               | Windows               |
| ------------------------------ | ----------------------------------- | --------------------- |
| Switch tab (full mode)         | ⌥C Assistant · ⌥A Ask AI · ⌥N Notes | Alt+C / A / N         |
| Answer now                     | ⌘Enter                              | Ctrl+Enter            |
| Answer what is on screen (focus) | ⌘⇧Enter                           | Ctrl+Shift+Enter      |
| Clear transcript (focus)       | ⌘⇧⌫                                 | Ctrl+Shift+Backspace  |
| Toggle Ask chat (focus)        | ⌥A                                  | Alt+A                 |
| New Ask chat                   | ⌘⇧N                                 | Ctrl+Shift+N          |
| Push-to-talk mic (empty input) | Space (hold)                        | Space (hold)          |
| Attach screenshot              | ⌘⇧1 (global)                        | Ctrl+Shift+1 (global) |
| Cancel mic / close drawer      | Esc                                 | Esc                   |


On first launch, macOS may prompt for **Screen Recording** (system audio) and **Microphone** (your side of the conversation and Ask AI dictation). In focus mode, a small **Screen access** chip opens System Settings without blocking the overlay.

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
