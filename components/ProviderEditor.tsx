import { useState, useEffect } from "react";
import { useIntent } from "@clapps/renderer";
import { cn } from "@/lib/utils";
import { X, Eye, EyeOff, Loader2, ExternalLink, Copy, Check, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ProviderType = "anthropic" | "openai" | "kimi-coding";
export type AuthMode = "api-key" | "subscription";

interface ProviderConfig {
  type: ProviderType;
  name: string;
  description: string;
  authModes: {
    mode: AuthMode;
    label: string;
    description: string;
    fields: FieldConfig[];
    helpUrl?: string;
  }[];
}

interface FieldConfig {
  name: string;
  label: string;
  type: "text" | "password" | "textarea";
  placeholder?: string;
  helpText?: string;
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    type: "anthropic",
    name: "Anthropic",
    description: "Claude models via API or subscription",
    authModes: [
      {
        mode: "api-key",
        label: "API Key",
        description: "Use your Anthropic API key (usage-based billing)",
        helpUrl: "https://console.anthropic.com/settings/keys",
        fields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            placeholder: "sk-ant-api03-...",
            helpText: "Get your API key from the Anthropic Console",
          },
        ],
      },
      {
        mode: "subscription",
        label: "Claude Subscription",
        description: "Use your Claude Pro/Max subscription",
        helpUrl: "https://docs.openclaw.ai/providers/anthropic#option-b-claude-setup-token",
        fields: [
          {
            name: "setupToken",
            label: "Setup Token",
            type: "textarea",
            placeholder: "Paste your setup token here...",
            helpText: "Run 'claude setup-token' in your terminal to generate this",
          },
        ],
      },
    ],
  },
  {
    type: "openai",
    name: "OpenAI",
    description: "GPT models via API or Codex subscription",
    authModes: [
      {
        mode: "api-key",
        label: "API Key",
        description: "Use your OpenAI API key (usage-based billing)",
        helpUrl: "https://platform.openai.com/api-keys",
        fields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            placeholder: "sk-...",
            helpText: "Get your API key from the OpenAI dashboard",
          },
        ],
      },
      {
        mode: "subscription",
        label: "Codex Subscription",
        description: "Use your ChatGPT Plus/Pro subscription via Codex",
        helpUrl: "https://docs.openclaw.ai/providers/openai#option-b-openai-code-codex-subscription",
        fields: [], // OAuth flow - no fields, just a button
      },
    ],
  },
  {
    type: "kimi-coding",
    name: "Kimi Coding",
    description: "Moonshot's Kimi K2 models for coding",
    authModes: [
      {
        mode: "api-key",
        label: "API Key",
        description: "Use your Kimi Coding API key",
        helpUrl: "https://platform.moonshot.cn/console/api-keys",
        fields: [
          {
            name: "apiKey",
            label: "API Key",
            type: "password",
            placeholder: "sk-...",
            helpText: "Get your API key from the Moonshot platform",
          },
        ],
      },
    ],
  },
];

interface ProviderEditorProps {
  isOpen: boolean;
  onClose: () => void;
  editingProvider?: {
    id: string;
    name: string;
    type: ProviderType;
    mode: string;
    authType?: "api-key" | "subscription" | "oauth";
    maskedCredential?: string;
  } | null;
}

export function ProviderEditor({ isOpen, onClose, editingProvider }: ProviderEditorProps) {
  const { emit } = useIntent();
  
  const [step, setStep] = useState<"select" | "configure">("select");
  const [selectedProvider, setSelectedProvider] = useState<ProviderType | null>(null);
  const [selectedAuthMode, setSelectedAuthMode] = useState<AuthMode | null>(null);
  const [customName, setCustomName] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      if (editingProvider) {
        // Editing existing provider
        setSelectedProvider(editingProvider.type);
        // Use authType if available, otherwise fall back to mode-based detection
        const authMode: AuthMode = editingProvider.authType === "subscription" || editingProvider.authType === "oauth"
          ? "subscription"
          : editingProvider.mode === "oauth" 
            ? "subscription" 
            : "api-key";
        setSelectedAuthMode(authMode);
        setCustomName(editingProvider.name);
        setStep("configure");
      } else {
        // Adding new provider
        setStep("select");
        setSelectedProvider(null);
        setSelectedAuthMode(null);
        setCustomName("");
      }
      setFieldValues({});
      setShowPassword({});
      setError(null);
      setIsSaving(false);
      setOauthUrl(null);
      setCallbackUrl("");
      setCopied(false);
      setOauthSuccess(false);
    }
  }, [isOpen, editingProvider]);

  const providerConfig = selectedProvider 
    ? PROVIDER_CONFIGS.find(p => p.type === selectedProvider)
    : null;

  const authModeConfig = providerConfig && selectedAuthMode
    ? providerConfig.authModes.find(a => a.mode === selectedAuthMode)
    : null;

  const handleProviderSelect = (type: ProviderType) => {
    setSelectedProvider(type);
    const config = PROVIDER_CONFIGS.find(p => p.type === type);
    if (config) {
      // Auto-select first auth mode
      setSelectedAuthMode(config.authModes[0].mode);
      // Set default name
      setCustomName(config.name);
    }
    setStep("configure");
  };

  const handleFieldChange = (fieldName: string, value: string) => {
    setFieldValues(prev => ({ ...prev, [fieldName]: value }));
    setError(null);
  };

  const togglePasswordVisibility = (fieldName: string) => {
    setShowPassword(prev => ({ ...prev, [fieldName]: !prev[fieldName] }));
  };

  const handleSave = async () => {
    if (!selectedProvider || !selectedAuthMode || !providerConfig) return;

    // Validate required fields
    if (authModeConfig?.fields.length) {
      for (const field of authModeConfig.fields) {
        if (!fieldValues[field.name]?.trim()) {
          setError(`${field.label} is required`);
          return;
        }
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      // Determine the intent based on provider and auth mode
      const intentName = getIntentName(selectedProvider, selectedAuthMode);
      const payload: Record<string, unknown> = {
        customName: customName.trim() || providerConfig.name,
        profileId: editingProvider?.id,
      };

      // Add field values to payload
      for (const field of authModeConfig?.fields ?? []) {
        payload[field.name] = fieldValues[field.name]?.trim();
      }

      emit(intentName, payload);

      // Wait a bit for the handler to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setIsSaving(false);
    }
  };

  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [oauthSuccess, setOauthSuccess] = useState(false);

  const handleOAuthLogin = async () => {
    if (!selectedProvider) return;

    setIsSaving(true);
    setError(null);

    try {
      const provider = selectedProvider === "openai" ? "openai-codex" : selectedProvider;
      const response = await fetch("/api/oauth/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider,
          customName: customName.trim() || providerConfig?.name,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to initiate OAuth");
      }

      const { authUrl } = await response.json();
      setOauthUrl(authUrl);
    } catch (err) {
      console.error("[oauth] Failed:", err);
      setError(err instanceof Error ? err.message : "OAuth failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!oauthUrl) return;
    await navigator.clipboard.writeText(oauthUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOAuthComplete = async () => {
    if (!callbackUrl.trim()) {
      setError("Please paste the callback URL");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/oauth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ callbackUrl: callbackUrl.trim() }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "OAuth callback failed");
      }

      setOauthSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      console.error("[oauth] Callback failed:", err);
      setError(err instanceof Error ? err.message : "Failed to complete sign in");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOAuthReset = () => {
    setOauthUrl(null);
    setCallbackUrl("");
    setError(null);
  };

  const handleDelete = () => {
    if (!editingProvider) return;
    
    if (confirm(`Delete "${editingProvider.name}"? This cannot be undone.`)) {
      emit("settings.deleteProvider", { profileId: editingProvider.id });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full sm:max-w-md bg-background rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold">
            {editingProvider ? "Edit Provider" : "Add Provider"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === "select" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-4">
                Choose a provider to add:
              </p>
              {PROVIDER_CONFIGS.map(provider => (
                <button
                  key={provider.type}
                  onClick={() => handleProviderSelect(provider.type)}
                  className="w-full text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors"
                >
                  <div className="font-medium">{provider.name}</div>
                  <div className="text-sm text-muted-foreground">{provider.description}</div>
                </button>
              ))}
            </div>
          )}

          {step === "configure" && providerConfig && (
            <div className="space-y-4">
              {/* Provider name input */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Display Name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={providerConfig.name}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Give this configuration a custom name (e.g., "Work Account", "Personal")
                </p>
              </div>

              {/* Auth mode selector (if multiple options) */}
              {providerConfig.authModes.length > 1 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Authentication Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    {providerConfig.authModes.map(authMode => (
                      <button
                        key={authMode.mode}
                        onClick={() => setSelectedAuthMode(authMode.mode)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-colors",
                          selectedAuthMode === authMode.mode
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-muted-foreground"
                        )}
                      >
                        <div className="text-sm font-medium">{authMode.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {authMode.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Auth fields */}
              {authModeConfig && (
                <div className="space-y-4">
                  {authModeConfig.fields.length > 0 ? (
                    authModeConfig.fields.map(field => (
                      <div key={field.name} className="space-y-2">
                        <label className="text-sm font-medium">{field.label}</label>
                        {/* Show current credential when editing */}
                        {editingProvider?.maskedCredential && !fieldValues[field.name] && (
                          <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded mb-1">
                            Current: {editingProvider.maskedCredential}
                          </div>
                        )}
                        {field.type === "textarea" ? (
                          <textarea
                            value={fieldValues[field.name] ?? ""}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            placeholder={editingProvider ? "Enter new value to replace..." : field.placeholder}
                            rows={4}
                            className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                          />
                        ) : (
                          <div className="relative">
                            <input
                              type={field.type === "password" && !showPassword[field.name] ? "password" : "text"}
                              value={fieldValues[field.name] ?? ""}
                              onChange={(e) => handleFieldChange(field.name, e.target.value)}
                              placeholder={editingProvider ? "Enter new value to replace..." : field.placeholder}
                              className="w-full h-10 px-3 pr-10 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {field.type === "password" && (
                              <button
                                type="button"
                                onClick={() => togglePasswordVisibility(field.name)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                              >
                                {showPassword[field.name] ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                        {field.helpText && (
                          <p className="text-xs text-muted-foreground">{field.helpText}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    /* OAuth flow - copy-paste approach for remote server compatibility */
                    <div className="space-y-3">
                      {oauthSuccess ? (
                        <div className="flex flex-col items-center gap-2 py-4">
                          <CheckCircle className="h-10 w-10 text-green-500" />
                          <p className="text-sm font-medium">Successfully connected!</p>
                          <p className="text-xs text-muted-foreground">Your {providerConfig.name} account has been linked.</p>
                        </div>
                      ) : !oauthUrl ? (
                        <>
                          <p className="text-sm text-muted-foreground">
                            Click the button below to start signing in with your {providerConfig.name} account.
                          </p>
                          <Button
                            onClick={handleOAuthLogin}
                            disabled={isSaving}
                            className="w-full"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Preparing...
                              </>
                            ) : (
                              `Sign in with ${providerConfig.name}`
                            )}
                          </Button>
                        </>
                      ) : (
                        <>
                          {/* Step 1: Auth URL */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Step 1: Open this URL and sign in</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={oauthUrl}
                                readOnly
                                className="flex-1 h-9 px-3 rounded-md border border-input bg-muted text-xs font-mono truncate"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyUrl}
                                className="shrink-0 h-9"
                              >
                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                            <a
                              href={oauthUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              Open in new tab
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>

                          {/* Step 2: Paste callback URL */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Step 2: Paste the callback URL</label>
                            <p className="text-xs text-muted-foreground">
                              After signing in, your browser will redirect to a page that may not load.
                              Copy the full URL from your browser's address bar and paste it here.
                            </p>
                            <input
                              type="text"
                              value={callbackUrl}
                              onChange={(e) => { setCallbackUrl(e.target.value); setError(null); }}
                              placeholder="http://127.0.0.1:1455/auth/callback?code=...&state=..."
                              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>

                          {/* Complete button */}
                          <Button
                            onClick={handleOAuthComplete}
                            disabled={isSaving || !callbackUrl.trim()}
                            className="w-full"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Completing...
                              </>
                            ) : (
                              "Complete Sign In"
                            )}
                          </Button>

                          {/* Start over link */}
                          <button
                            onClick={handleOAuthReset}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Start over
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Help link */}
                  {authModeConfig.helpUrl && (
                    <a
                      href={authModeConfig.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Learn more
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "configure" && authModeConfig?.fields.length !== 0 && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
            {editingProvider && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isSaving}
                className="mr-auto"
              >
                Delete
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => editingProvider ? onClose() : setStep("select")}
              disabled={isSaving}
            >
              {editingProvider ? "Cancel" : "Back"}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                editingProvider ? "Update" : "Add Provider"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function getIntentName(provider: ProviderType, authMode: AuthMode): string {
  const map: Record<string, Record<AuthMode, string>> = {
    anthropic: {
      "api-key": "settings.setAnthropicKey",
      subscription: "settings.setClaudeToken",
    },
    openai: {
      "api-key": "settings.setOpenAIKey",
      subscription: "settings.startOAuth", // Handled separately
    },
    "kimi-coding": {
      "api-key": "settings.setKimiCodingKey",
      subscription: "settings.setKimiCodingKey", // No subscription mode
    },
  };

  return map[provider]?.[authMode] ?? "settings.addProvider";
}
