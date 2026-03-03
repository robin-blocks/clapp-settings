# Settings Clapp

The default settings clapp for OpenClaw. Provides UI for managing AI providers, models, and session configurations.

**Repo:** https://github.com/robin-blocks/clapp-settings  
**Parent monorepo:** https://github.com/robin-blocks/clapps

## Installation

This clapp is installed automatically by `@clapps/connect`. To install manually or update:

```bash
git clone https://github.com/robin-blocks/clapp-settings.git ~/.openclaw/clapps/settings
```

## Features

- **Provider Management**: Add, edit, and delete AI provider credentials
  - Anthropic (API key + Claude subscription)
  - OpenAI (API key + Codex subscription)
  - Kimi Coding (API key)
  
- **Model Selection**: Choose default model for new sessions

- **Session Management**: View active sessions and their model overrides
  - See which sessions differ from the system default
  - Reset individual sessions to default
  - Apply default to all sessions at once

## Structure

```
settings/
├── clapp.json                    # Manifest
├── views/
│   ├── settings.app.md           # App definition
│   └── default.settings.view.md  # Main view layout
├── components/
│   ├── ProviderList.tsx          # Provider/model selector
│   ├── ProviderEditor.tsx        # Add/edit provider modal
│   └── SessionList.tsx           # Active sessions display
├── handlers/
│   └── settings-handler.ts       # Intent handler (server-side)
└── README.md
```

## Intents

| Intent | Description |
|--------|-------------|
| `settings.setAnthropicKey` | Set Anthropic API key |
| `settings.setClaudeToken` | Set Claude subscription token |
| `settings.setOpenAIKey` | Set OpenAI API key |
| `settings.setKimiCodingKey` | Set Kimi Coding API key |
| `settings.setActiveModel` | Set the default model |
| `settings.deleteProvider` | Remove a provider profile |
| `settings.listSessions` | Refresh session list |
| `settings.resetSessionModel` | Reset session to default |
| `settings.applyDefaultToAll` | Sync all sessions to default |

## Development

This clapp is a git submodule of the main clapps monorepo.

**To customize locally:**
1. Edit files in `~/.openclaw/clapps/settings/`
2. Restart the connect server to see changes

**To contribute:**
```bash
cd ~/.openclaw/clapps/settings
git checkout -b my-feature
# Make changes
git commit -am "Add my feature"
git push origin my-feature
# Open PR at https://github.com/robin-blocks/clapp-settings
```

**In the parent monorepo:**
```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/robin-blocks/clapps.git

# Sync clapp files into packages for build
pnpm sync:clapps

# Build and run
pnpm build
cd packages/connect && node dist/index.js
```
