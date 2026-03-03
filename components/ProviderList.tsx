import { useEffect, useMemo, useState } from "react";
import { useClappState, useIntent } from "@clapps/renderer";
import { cn } from "@/lib/utils";
import { Check, Loader2, Pencil, Plus, ChevronDown } from "lucide-react";
import { ProviderEditor, type ProviderType } from "./ProviderEditor";

interface ModelOption {
  id: string;
  label: string;
}

interface Provider {
  id: string;
  name: string;
  configured: boolean;
  mode: string;
  authType?: "api-key" | "subscription" | "oauth";
  maskedCredential: string;
  active?: boolean;
  models?: ModelOption[];
}

function getProviderIdentifier(profileId: string): string {
  const [, identifier] = profileId.split(":");
  return identifier || profileId;
}

function providerOptionLabel(provider: Provider): string {
  return `${provider.name} · ${getProviderIdentifier(provider.id)}`;
}

interface ProviderListProps {
  data?: string;
}

export function ProviderList({ data = "configuredProviders" }: ProviderListProps) {
  const providers = useClappState<Provider[]>(data) ?? [];
  const activeModel = useClappState<string>("active.model") ?? "";
  const activeProfileId = useClappState<string>("active.profileId") ?? "";
  const { emit } = useIntent();

  const activeProvider = providers.find((p) => p.active) ?? providers[0];

  const [selectedProviderId, setSelectedProviderId] = useState<string>(activeProfileId || activeProvider?.id || "");
  const [selectedModelId, setSelectedModelId] = useState<string>(activeModel ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isSlow, setIsSlow] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  
  // Editor modal state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<{
    id: string;
    name: string;
    type: ProviderType;
    mode: string;
  } | null>(null);

  const isDirty =
    selectedProviderId !== (activeProfileId || activeProvider?.id || "") ||
    selectedModelId !== (activeModel ?? "");

  useEffect(() => {
    if (!activeProvider && !activeProfileId) return;
    // Hydrate from backend only on first load, or when form is clean and not saving.
    // Do NOT overwrite local selection while a save is in progress.
    if (!selectedProviderId || (!isSaving && !isDirty)) {
      setSelectedProviderId(activeProfileId || activeProvider?.id || "");
    }
  }, [activeProvider, activeProfileId, isSaving, isDirty, selectedProviderId]);

  useEffect(() => {
    if (!activeModel) return;
    // Keep local selection stable while user is editing/saving.
    if (!selectedModelId || (!isSaving && !isDirty)) {
      setSelectedModelId(activeModel);
    }
  }, [activeModel, isSaving, selectedModelId, isDirty]);

  const availableModels = useMemo(() => {
    const provider = providers.find((p) => p.id === selectedProviderId);
    return provider?.models ?? [];
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (!availableModels.length) return;

    const selectedStillValid = availableModels.some((m) => m.id === selectedModelId);
    if (!selectedStillValid) {
      setSelectedModelId(availableModels[0].id);
    }
  }, [availableModels, selectedModelId]);

  const providerChanged = selectedProviderId !== (activeProfileId || activeProvider?.id || "");
  const modelChanged = Boolean(selectedModelId && selectedModelId !== activeModel);
  const hasChange = providerChanged || modelChanged;

  useEffect(() => {
    if (!isSaving) return;

    const profileMatches = (activeProfileId || activeProvider?.id || "") === selectedProviderId;
    const modelMatches = !modelChanged || (activeModel === selectedModelId && activeModel.length > 0);

    if (profileMatches && modelMatches) {
      setIsSaving(false);
      setIsSlow(false);
      setSaveWarning(null);
    }
  }, [activeModel, selectedModelId, selectedProviderId, activeProfileId, activeProvider, modelChanged, isSaving]);

  useEffect(() => {
    if (!isSaving) return;

    const slowTimer = setTimeout(() => setIsSlow(true), 10000);
    const timeoutTimer = setTimeout(() => {
      setIsSaving(false);
      setIsSlow(false);
      setSaveWarning("Still applying took too long. Changes may still complete in the background.");
    }, 30000);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    };
  }, [isSaving]);

  const providerForSelection = providers.find((p) => p.id === selectedProviderId);

  const onProviderChange = (providerId: string) => {
    if (isSaving) return;
    setSelectedProviderId(providerId);

    const provider = providers.find((p) => p.id === providerId);
    const firstModel = provider?.models?.[0]?.id;
    if (firstModel) {
      setSelectedModelId(firstModel);
    } else {
      setSelectedModelId("");
    }
  };

  const onSave = () => {
    if (!hasChange || !selectedModelId || isSaving) return;
    setIsSaving(true);
    setIsSlow(false);
    setSaveWarning(null);

    if (providerChanged) {
      emit("settings.setActiveProfile", { profileId: selectedProviderId });
    }

    if (modelChanged) {
      emit("settings.setActiveModel", { model: selectedModelId });
    }
  };

  const openAddProvider = () => {
    setEditingProvider(null);
    setIsEditorOpen(true);
  };

  const openEditProvider = (provider: Provider) => {
    // Extract provider type from profile ID (format: "provider:suffix")
    const providerKey = provider.id.split(":")[0];
    
    // Map provider key to ProviderType
    const typeMap: Record<string, ProviderType> = {
      anthropic: "anthropic",
      openai: "openai",
      "openai-codex": "openai",
      "kimi-coding": "kimi-coding",
      moonshot: "kimi-coding",
    };

    setEditingProvider({
      id: provider.id,
      name: provider.name,
      type: typeMap[providerKey] ?? "anthropic",
      mode: provider.mode,
      authType: provider.authType,
      maskedCredential: provider.maskedCredential,
    });
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingProvider(null);
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">System Default</p>
          <p className="text-sm font-medium">Default model for new sessions</p>
        </div>

        {/* Provider selector with edit button */}
        <div className="grid grid-cols-1 gap-2">
          <label className="text-xs text-muted-foreground">Provider</label>
          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <select
                value={selectedProviderId}
                onChange={(e) => onProviderChange(e.target.value)}
                disabled={isSaving || providers.length === 0}
                className="h-10 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-70"
              >
                {providers.length === 0 ? (
                  <option value="">No providers configured</option>
                ) : (
                  providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {providerOptionLabel(provider)}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
            
            {/* Edit button */}
            {providerForSelection && (
              <button
                type="button"
                onClick={() => openEditProvider(providerForSelection)}
                disabled={isSaving}
                className={cn(
                  "flex items-center justify-center h-10 w-10 rounded-md border border-input bg-background",
                  "hover:bg-muted transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                title={`Edit ${providerForSelection.name}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Model selector */}
        <div className="grid grid-cols-1 gap-2">
          <label className="text-xs text-muted-foreground">Model</label>
          <div className="relative">
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              disabled={isSaving || availableModels.length === 0}
              className="h-10 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-10 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-70"
            >
              {availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Credential info */}
        {providerForSelection && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div>{providerOptionLabel(providerForSelection)}: {providerForSelection.maskedCredential ?? "No credential"}</div>
            <div className="opacity-70">id: {providerForSelection.id}</div>
          </div>
        )}

        {/* Save button */}
        <button
          type="button"
          onClick={onSave}
          disabled={!hasChange || !selectedModelId || isSaving}
          className={cn(
            "inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors",
            "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isSlow ? "Still applying…" : "Updating model…"}
            </>
          ) : hasChange ? (
            "Save changes"
          ) : (
            <>
              <Check className="h-4 w-4" />
              Up to date
            </>
          )}
        </button>
        {saveWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{saveWarning}</p>
        )}

        {/* Add provider button */}
        <div className="pt-2 border-t border-border">
          <button
            type="button"
            onClick={openAddProvider}
            className={cn(
              "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border",
              "text-sm font-medium text-muted-foreground",
              "hover:border-primary hover:text-foreground hover:bg-muted/50 transition-colors"
            )}
          >
            <Plus className="h-4 w-4" />
            Add Provider
          </button>
        </div>
      </div>

      {/* Provider editor modal */}
      <ProviderEditor
        isOpen={isEditorOpen}
        onClose={closeEditor}
        editingProvider={editingProvider}
      />
    </>
  );
}
