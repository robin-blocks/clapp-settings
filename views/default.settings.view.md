---
name: settings
domain: default
version: 0.6.0
---

## State Bindings
- `active.isConfigured` -> boolean
- `active.model` -> string
- `configuredProviders` -> array
- `sessions.sessions` -> array
- `sessions.globalModel` -> string

## Layout
```clapp-layout
Column(gap=5):
  Card(title=AI Providers):
    Column(gap=4):
      Conditional(when=active.isConfigured):
        ProviderList(data=configuredProviders):
      Conditional(when=!active.isConfigured):
        Heading(level=4): "No providers configured"
      SessionList():
```

## Intents
| Name | Payload | Description |
|------|---------|-------------|
| settings.setAnthropicKey | `{ apiKey: string, customName?: string }` | Set an Anthropic API key |
| settings.setClaudeToken | `{ setupToken: string, customName?: string }` | Set a Claude subscription token |
| settings.setOpenAIKey | `{ apiKey: string, customName?: string }` | Set an OpenAI API key |
| settings.setKimiCodingKey | `{ apiKey: string, customName?: string }` | Set a Kimi Coding API key |
| settings.setActiveProvider | `{ provider: string }` | Set the active AI provider |
| settings.setActiveModel | `{ model: string }` | Set the active AI model |
| settings.deleteProvider | `{ profileId: string }` | Delete a provider profile |
| settings.listSessions | `{}` | Refresh the list of active sessions |
| settings.resetSessionModel | `{ sessionKey: string }` | Reset a session to use the system default |
| settings.applyDefaultToAll | `{}` | Apply system default to all sessions |
