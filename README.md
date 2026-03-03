# Settings Clapp

The default settings clapp for OpenClaw. Provides UI for managing AI providers, models, and session configurations.

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

## Customization

To customize this clapp:

1. The clapp is installed to `~/.openclaw/clapps/settings/`
2. Edit the files locally — changes take effect on reload
3. If you want to contribute changes back:
   ```bash
   cd ~/.openclaw/clapps/settings
   git status                    # See your changes
   git commit -am "My improvement"
   git push origin main          # Push to your fork
   # Then open a PR on GitHub
   ```

## Development

When developing in the main clapps monorepo:

```bash
# Components are symlinked/copied during build
pnpm build

# Run the connect server
cd packages/connect && node dist/index.js
```
