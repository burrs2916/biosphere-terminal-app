# Biosphere Terminal App 🚀

**A next-generation terminal application that bridges the gap between powerful command-line tools and intuitive visual interfaces.**

## Overview

Biosphere Terminal App is a modern, cross-platform terminal emulator built with [Tauri v2](https://tauri.app), offering a seamless blend of traditional terminal capabilities and advanced productivity features. It transforms the command-line experience with AI-powered assistance, intelligent note management, and visual session control.

## Key Features

### 🖥️ Advanced Terminal Emulation
- Full-featured PTY (Pseudo-Terminal) backend with real-time output streaming
- Multi-session management with split-pane layouts
- SSH and serial connection support
- Command history tracking with intelligent search
- Connection profiles for quick access to remote systems

### 📝 Smart Notebook System
- Markdown-based note editor with rich formatting (powered by [Tiptap](https://tiptap.dev))
- YAML front matter for metadata management
- Organize notes by groups and categories
- Link terminal commands to notes for contextual documentation
- Pin important notes for quick access

### 🤖 AI-Powered Agent
- OpenAI-compatible LLM integration for intelligent assistance
- Tool-based agent architecture with specialized capabilities:
  - **Notebook Tool**: Search, create, update, and organize notes
  - **Terminal Tool**: Execute commands and capture output
  - **Command History Tool**: Access and learn from past commands
  - **File Tool**: File system operations
- Streaming responses for real-time interaction
- Conversation history with context preservation

### 🎨 Modern UI/UX
- Built with [Material UI](https://mui.com) for a polished, professional interface
- Responsive design adapting to any screen size
- Dark theme optimized for extended coding sessions
- Customizable icon groups for visual organization
- Internationalization support (English & Chinese)

## Architecture

```
Biosphere Terminal App
├── Frontend (React + TypeScript + Vite)
│   ├── Material UI components
│   ├── Tiptap rich text editor
│   └── Zustand state management
│
├── Backend (Rust + Tauri v2)
│   ├── Terminal Service (PTY, SSH, Serial)
│   ├── Notebook Service (Markdown notes)
│   ├── Agent Service (AI integration)
│   ├── Session & Connection Management
│   └── SQLite Database
│
└── AI Agent Layer
    ├── Provider abstraction (OpenAI-compatible)
    ├── Tool-based action system
    └── ReAct loop for intelligent automation
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Material UI, Tiptap
- **Backend**: Rust, Tauri v2, Tokio async runtime
- **Database**: SQLite with Rusqlite
- **AI**: OpenAI-compatible API integration
- **Terminal**: portable-pty for cross-platform PTY support

## Getting Started

### Prerequisites
- Node.js 20+ and pnpm
- Rust 1.77+ with `cargo`
- Tauri CLI: `cargo install tauri-cli`

### Installation

```bash
# Clone the repository
git clone https://github.com/burrs2916/biosphere-terminal-app.git
cd biosphere-terminal-app

# Install frontend dependencies
pnpm install

# Start development server
pnpm tauri dev
```

### Build for Production

```bash
pnpm tauri build
```

## Project Structure

```
biosphere-terminal-app/
├── src/                      # React frontend
│   ├── features/             # Feature modules
│   │   ├── terminal/         # Terminal UI components
│   │   ├── notebook/         # Note editor & management
│   │   ├── agent/            # AI agent interface
│   │   └── session/          # Session management
│   ├── core/                 # Services & API clients
│   └── components/           # Shared UI components
│
└── src-tauri/                # Rust backend
    ├── src/
    │   ├── app/              # Core services
    │   ├── domain/           # Business logic
    │   ├── infra/            # Infrastructure (DB, FS)
    │   ├── interface/        # Tauri commands & events
    │   └── plugins/          # AI agent & tools
    └── Cargo.toml
```

## License

MIT
