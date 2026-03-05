import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { IntentMessage } from "@clapps/core";
import { checkAuthStatus } from "./defaults.js";
import type { StateStore } from "./state-store.js";

export interface SettingsHandlerOptions {
  stateDir: string;
  store: StateStore;
  authProfilesPath?: string;
  /** Home directory where openclaw config lives (defaults to os.homedir()) */
  openclawHome?: string;
  /** Called after any file write under openclawHome (config, auth-profiles, etc.) */
  onConfigChanged?: () => void;
  /** Called after the system default model changes (e.g. to restart gateway) */
  onModelDefaultChanged?: () => void;
}

interface AuthProfile {
  type: string;
  provider: string;
  token?: string;
  key?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
  customName?: string; // User-defined display name for the profile
}

interface AuthProfilesFile {
  version?: number;
  profiles: Record<string, AuthProfile>;
}

interface ModelOption {
  id: string;
  label: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  mode: string;
  authType: "api-key" | "subscription" | "oauth";
  maskedCredential: string;
  active?: boolean;
  models: ModelOption[];
}

export class SettingsHandler {
  private stateDir: string;
  private store: StateStore;
  private authProfilesPath: string;
  private openclawHome: string;
  private onConfigChanged?: () => void;
  private onModelDefaultChanged?: () => void;

  constructor(options: SettingsHandlerOptions) {
    this.stateDir = options.stateDir;
    this.store = options.store;
    this.openclawHome = options.openclawHome ?? homedir();
    this.authProfilesPath =
      options.authProfilesPath ??
      resolve(this.openclawHome, ".openclaw", "agents", "main", "agent", "auth-profiles.json");
    this.onConfigChanged = options.onConfigChanged;
    this.onModelDefaultChanged = options.onModelDefaultChanged;
  }

  /** Returns true if the intent was handled locally (should not be forwarded to ACP) */
  handleIntent = (intent: IntentMessage): boolean => {
    if (!intent.intent.startsWith("settings.")) return false;

    const customName = typeof intent.payload.customName === "string" 
      ? intent.payload.customName.trim() 
      : undefined;
    const profileId = typeof intent.payload.profileId === "string"
      ? intent.payload.profileId.trim()
      : undefined;

    switch (intent.intent) {
      case "settings.setAnthropicKey": {
        const apiKey = intent.payload.apiKey;
        if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
          console.warn("[settings] Invalid apiKey payload, ignoring");
          return true;
        }
        this.setAnthropicKey(apiKey.trim(), customName, profileId);
        return true;
      }
      case "settings.setClaudeToken": {
        const token = intent.payload.setupToken ?? intent.payload.token;
        if (typeof token !== "string" || token.trim().length === 0) {
          console.warn("[settings] Invalid token/setupToken payload, ignoring");
          return true;
        }
        this.setClaudeToken(token.trim(), customName);
        return true;
      }
      case "settings.setOpenAIKey": {
        const apiKey = intent.payload.apiKey;
        if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
          console.warn("[settings] Invalid apiKey payload, ignoring");
          return true;
        }
        this.setOpenAIKey(apiKey.trim(), customName, profileId);
        return true;
      }
      case "settings.setKimiCodingKey": {
        const apiKey = intent.payload.apiKey;
        if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
          console.warn("[settings] Invalid apiKey payload, ignoring");
          return true;
        }
        this.setKimiCodingKey(apiKey.trim(), customName, profileId);
        return true;
      }
      case "settings.startOAuth": {
        const provider = intent.payload.provider;
        if (typeof provider !== "string" || provider.trim().length === 0) {
          console.warn("[settings] Invalid provider payload for OAuth, ignoring");
          return true;
        }
        this.startOAuth(provider.trim(), customName);
        return true;
      }
      case "settings.deleteProvider": {
        if (!profileId) {
          console.warn("[settings] Missing profileId for deleteProvider, ignoring");
          return true;
        }
        this.deleteProvider(profileId);
        return true;
      }
      case "settings.setActiveProvider": {
        const provider = intent.payload.provider;
        if (typeof provider !== "string" || provider.trim().length === 0) {
          console.warn("[settings] Invalid provider payload, ignoring");
          return true;
        }
        this.setActiveProvider(provider.trim().toLowerCase());
        return true;
      }
      case "settings.setActiveProfile": {
        const profileId = intent.payload.profileId;
        if (typeof profileId !== "string" || profileId.trim().length === 0) {
          console.warn("[settings] Invalid profileId payload, ignoring");
          return true;
        }
        this.setActiveProfile(profileId.trim());
        return true;
      }
      case "settings.setActiveModel": {
        const model = intent.payload.model;
        if (typeof model !== "string" || model.trim().length === 0) {
          console.warn("[settings] Invalid model payload, ignoring");
          return true;
        }
        this.setActiveModel(model.trim().toLowerCase());
        return true;
      }
      case "settings.listSessions": {
        this.listSessions();
        return true;
      }
      case "settings.resetSessionModel": {
        const sessionKey = intent.payload.sessionKey;
        if (typeof sessionKey !== "string" || sessionKey.trim().length === 0) {
          console.warn("[settings] Invalid sessionKey payload, ignoring");
          return true;
        }
        this.resetSessionModel(sessionKey.trim());
        return true;
      }
      case "settings.applyDefaultToAll": {
        this.applyDefaultToAllSessions();
        return true;
      }
      default:
        console.warn(`[settings] Unknown settings intent: ${intent.intent}`);
        return true;
    }
  };

  /** Spawn openclaw CLI with correct HOME env */
  private spawnClaw(args: string[], opts?: { input?: string; timeout?: number }) {
    const result = spawnSync("openclaw", args, {
      encoding: "utf-8" as const,
      timeout: opts?.timeout ?? 15_000,
      input: opts?.input,
      env: { ...process.env, HOME: this.openclawHome },
    });
    this.onConfigChanged?.();
    return result;
  }

  /** Generate a unique profile ID */
  private generateProfileId(provider: string, customName?: string): string {
    const suffix = customName 
      ? customName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")
      : "manual";
    return `${provider}:${suffix}`;
  }

  /** Write auth-profiles.json with the Anthropic API key */
  private setAnthropicKey(apiKey: string, customName?: string, existingProfileId?: string): void {
    let profiles: AuthProfilesFile = { version: 1, profiles: {} };
    try {
      if (existsSync(this.authProfilesPath)) {
        profiles = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
      }
    } catch {
      // Start fresh if unreadable
    }

    const profileId = existingProfileId ?? this.generateProfileId("anthropic", customName);
    
    profiles.profiles[profileId] = {
      type: "token",
      provider: "anthropic",
      token: apiKey,
      customName: customName || "Anthropic API",
    };

    mkdirSync(dirname(this.authProfilesPath), { recursive: true });
    writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
    this.onConfigChanged?.();
    console.log(`✅ Anthropic API key saved to ${this.authProfilesPath} (profile: ${profileId})`);

    this.writeSettingsState();
    this.pushSettingsState();

    checkAuthStatus(this.stateDir, this.authProfilesPath);
    this.pushStatusState();
  }

  /** Set Claude subscription token via openclaw CLI */
  private setClaudeToken(token: string, customName?: string): void {
    const result = this.spawnClaw(
      ["models", "auth", "paste-token", "--provider", "anthropic"],
      { input: token },
    );

    if (result.status !== 0) {
      const msg = (result.stderr || result.error?.message || "unknown error").toString().trim();
      console.error(`[settings] openclaw paste-token failed: ${msg}`);
      return;
    }

    // Update the profile with custom name if provided
    if (customName) {
      try {
        if (existsSync(this.authProfilesPath)) {
          const profiles: AuthProfilesFile = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
          // Find the anthropic profile that was just updated
          for (const [key, profile] of Object.entries(profiles.profiles)) {
            if (profile.provider === "anthropic" && (profile.access || profile.refresh)) {
              profile.customName = customName;
              break;
            }
          }
          writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
          this.onConfigChanged?.();
        }
      } catch {
        // Ignore errors updating custom name
      }
    }

    console.log("✅ Claude subscription token saved via openclaw");

    this.writeSettingsState();
    this.pushSettingsState();

    checkAuthStatus(this.stateDir, this.authProfilesPath);
    this.pushStatusState();
  }

  /** Write auth-profiles.json with the OpenAI API key */
  private setOpenAIKey(apiKey: string, customName?: string, existingProfileId?: string): void {
    let profiles: AuthProfilesFile = { version: 1, profiles: {} };
    try {
      if (existsSync(this.authProfilesPath)) {
        profiles = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
      }
    } catch {
      // Start fresh if unreadable
    }

    const profileId = existingProfileId ?? this.generateProfileId("openai", customName);

    profiles.profiles[profileId] = {
      type: "token",
      provider: "openai",
      token: apiKey,
      customName: customName || "OpenAI API",
    };

    // Also set the env var in openclaw.json for compatibility
    this.setEnvVar("OPENAI_API_KEY", apiKey);

    mkdirSync(dirname(this.authProfilesPath), { recursive: true });
    writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
    this.onConfigChanged?.();
    console.log(`✅ OpenAI API key saved to ${this.authProfilesPath} (profile: ${profileId})`);

    this.writeSettingsState();
    this.pushSettingsState();

    checkAuthStatus(this.stateDir, this.authProfilesPath);
    this.pushStatusState();
  }

  /** Write auth-profiles.json with the Kimi Coding API key */
  private setKimiCodingKey(apiKey: string, customName?: string, existingProfileId?: string): void {
    let profiles: AuthProfilesFile = { version: 1, profiles: {} };
    try {
      if (existsSync(this.authProfilesPath)) {
        profiles = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
      }
    } catch {
      // Start fresh if unreadable
    }

    const profileId = existingProfileId ?? this.generateProfileId("kimi-coding", customName);

    profiles.profiles[profileId] = {
      type: "token",
      provider: "kimi-coding",
      token: apiKey,
      customName: customName || "Kimi Coding",
    };

    // Also set the env var in openclaw.json for compatibility
    this.setEnvVar("KIMI_API_KEY", apiKey);

    mkdirSync(dirname(this.authProfilesPath), { recursive: true });
    writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
    this.onConfigChanged?.();
    console.log(`✅ Kimi Coding API key saved to ${this.authProfilesPath} (profile: ${profileId})`);

    this.writeSettingsState();
    this.pushSettingsState();

    checkAuthStatus(this.stateDir, this.authProfilesPath);
    this.pushStatusState();
  }

  /** Start OAuth flow for a provider */
  private startOAuth(provider: string, customName?: string): void {
    const result = this.spawnClaw(
      ["models", "auth", "login", "--provider", provider],
      { timeout: 30_000 },
    );

    if (result.status !== 0) {
      console.error(`[settings] OAuth login failed for ${provider}`);
      return;
    }

    // Update with custom name if provided
    if (customName) {
      try {
        if (existsSync(this.authProfilesPath)) {
          const profiles: AuthProfilesFile = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
          for (const [_key, profile] of Object.entries(profiles.profiles)) {
            if (profile.provider === provider && (profile.access || profile.refresh)) {
              profile.customName = customName;
              break;
            }
          }
          writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
          this.onConfigChanged?.();
        }
      } catch {
        // Ignore errors
      }
    }

    console.log(`✅ OAuth login completed for ${provider}`);

    this.writeSettingsState();
    this.pushSettingsState();

    checkAuthStatus(this.stateDir, this.authProfilesPath);
    this.pushStatusState();
  }

  /** Delete a provider profile */
  private deleteProvider(profileId: string): void {
    try {
      if (!existsSync(this.authProfilesPath)) {
        console.warn(`[settings] No auth-profiles.json found`);
        return;
      }

      const profiles: AuthProfilesFile = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
      
      if (!profiles.profiles[profileId]) {
        console.warn(`[settings] Profile "${profileId}" not found`);
        return;
      }

      delete profiles.profiles[profileId];
      writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
      this.onConfigChanged?.();
      console.log(`✅ Deleted provider profile: ${profileId}`);

      this.writeSettingsState();
      this.pushSettingsState();

      checkAuthStatus(this.stateDir, this.authProfilesPath);
      this.pushStatusState();
    } catch (err) {
      console.error(`[settings] Failed to delete provider: ${err}`);
    }
  }

  /** Set an environment variable in openclaw.json */
  private setEnvVar(key: string, value: string): void {
    try {
      const configPath = resolve(this.openclawHome, ".openclaw", "openclaw.json");
      let config: Record<string, unknown> = {};
      
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, "utf-8"));
      }

      if (!config.env || typeof config.env !== "object") {
        config.env = {};
      }
      (config.env as Record<string, string>)[key] = value;

      if (config.meta && typeof config.meta === "object") {
        (config.meta as Record<string, unknown>).lastTouchedAt = new Date().toISOString();
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      this.onConfigChanged?.();
      console.log(`[settings] Set ${key} in openclaw.json`);
    } catch (err) {
      console.warn(`[settings] Failed to set env var ${key}: ${err}`);
    }
  }

  /** Set the active AI provider by choosing its first configured model */
  private setActiveProvider(provider: string): void {
    const modelId = this.getFirstModelForProvider(provider);
    if (!modelId) {
      console.warn(`[settings] Unknown provider or no models available: ${provider}`);
      return;
    }

    this.setActiveModel(modelId);
  }

  /** Set the active auth profile for a provider by copying it to <provider>:default */
  private setActiveProfile(profileId: string): void {
    try {
      if (!existsSync(this.authProfilesPath)) {
        console.warn("[settings] auth-profiles.json not found");
        return;
      }

      const profiles: AuthProfilesFile = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));
      const selected = profiles.profiles[profileId];
      if (!selected) {
        console.warn(`[settings] Profile not found: ${profileId}`);
        return;
      }

      const provider = selected.provider;
      const defaultProfileId = `${provider}:default`;

      if (profileId !== defaultProfileId) {
        profiles.profiles[defaultProfileId] = {
          ...selected,
          customName: selected.customName ?? "default",
        };
        writeFileSync(this.authProfilesPath, JSON.stringify(profiles, null, 2), "utf-8");
        this.onConfigChanged?.();
      }

      console.log(`✅ Active ${provider} profile set to ${profileId} (via ${defaultProfileId})`);
      this.writeSettingsState();
      this.pushSettingsState();
    } catch (err) {
      console.error(`[settings] Failed to set active profile: ${(err as Error).message}`);
    }
  }

  /** Set the active model system-wide */
  private setActiveModel(modelId: string): void {
    const result = this.spawnClaw(
      ["models", "set", modelId],
      { timeout: 20_000 },
    );

    if (result.status !== 0) {
      const msg = (result.stderr || result.error?.message || "unknown error").toString().trim();
      console.error(`[settings] Failed to set default model: ${msg}`);
      return;
    }

    this.clearAgentModelOverrides(modelId);

    // Let deployment handle gateway restart/reload
    this.onModelDefaultChanged?.();

    console.log(`✅ Active model set system-wide to ${modelId}`);

    this.writeSettingsState();
    this.pushSettingsState();
  }

  /** Clear per-agent model overrides so all agents use the system default */
  private clearAgentModelOverrides(newModelId: string): void {
    try {
      const configPath = resolve(this.openclawHome, ".openclaw", "openclaw.json");
      if (!existsSync(configPath)) return;

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      
      // Update agents.list to use the new model (or remove overrides)
      if (Array.isArray(config.agents?.list)) {
        let changed = false;
        for (const agent of config.agents.list) {
          if (agent.model && agent.model !== newModelId) {
            // Set all agents to use the same model for system-wide consistency
            agent.model = newModelId;
            changed = true;
            console.log(`[settings] Updated agent "${agent.id}" model to ${newModelId}`);
          }
        }
        
        if (changed) {
          // Update lastTouchedAt timestamp
          if (config.meta) {
            config.meta.lastTouchedAt = new Date().toISOString();
          }
          
          writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
          this.onConfigChanged?.();
          console.log(`[settings] Saved openclaw.json with updated agent models`);
        }
      }
    } catch (err) {
      console.warn(`[settings] Failed to update agent model overrides: ${err}`);
    }

    // Patch all active sessions to use the new model
    this.patchAllSessionModels(newModelId);
  }

  /** Patch model on all direct sessions by writing the sessions store directly */
  private patchAllSessionModels(newModelId: string): void {
    try {
      const [provider, ...rest] = newModelId.split("/");
      const model = rest.join("/");
      if (!provider || !model) {
        console.warn(`[settings] Invalid model ID: ${newModelId}`);
        return;
      }

      const sessionsPath = resolve(
        this.openclawHome, ".openclaw", "agents", "main", "sessions", "sessions.json",
      );
      if (!existsSync(sessionsPath)) {
        console.warn(`[settings] Sessions file not found: ${sessionsPath}`);
        return;
      }

      const sessions = JSON.parse(readFileSync(sessionsPath, "utf-8"));
      let changed = 0;

      for (const [key, sess] of Object.entries(sessions as Record<string, Record<string, unknown>>)) {
        // Only patch direct (user-facing) sessions, skip internal clapps sessions
        if (key.includes(":clapps-chat") || key.includes(":clapps-title")) continue;
        const kind = sess.chatType ?? sess.kind;
        if (kind !== "direct") continue;

        if (sess.modelProvider !== provider || sess.model !== model) {
          sess.modelProvider = provider;
          sess.model = model;
          changed++;
          console.log(`[settings] Patched session "${key}" model to ${newModelId}`);
        }
      }

      if (changed > 0) {
        writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), "utf-8");
        this.onConfigChanged?.();
        console.log(`[settings] Updated ${changed} session(s) to ${newModelId}`);
      } else {
        console.log(`[settings] All sessions already on ${newModelId}`);
      }
    } catch (err) {
      console.warn(`[settings] Failed to patch session models: ${err}`);
    }
  }

  /** Get the active model from OpenClaw config */
  private getActiveModel(): { provider: string; model: string } | null {
    try {
      const configPath = resolve(this.openclawHome, ".openclaw", "openclaw.json");
      if (!existsSync(configPath)) return null;

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const primary = config?.agents?.defaults?.model?.primary;
      
      if (typeof primary === "string" && primary.includes("/")) {
        const [provider, ...rest] = primary.split("/");
        return { provider, model: rest.join("/") };
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /** Read available models grouped by provider from OpenClaw config */
  private getModelCatalogByProvider(): Map<string, ModelOption[]> {
    const map = new Map<string, ModelOption[]>();
    try {
      const configPath = resolve(this.openclawHome, ".openclaw", "openclaw.json");
      if (!existsSync(configPath)) return map;

      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const models = config?.agents?.defaults?.models ?? {};

      for (const [modelId, meta] of Object.entries(models as Record<string, unknown>)) {
        if (typeof modelId !== "string" || !modelId.includes("/")) continue;
        const [provider] = modelId.split("/");
        if (!provider) continue;

        const label = this.formatModelLabel(modelId, meta as Record<string, unknown> | undefined);
        const existing = map.get(provider) ?? [];
        existing.push({ id: modelId, label });
        map.set(provider, existing);
      }

      for (const [provider, entries] of map) {
        entries.sort((a, b) => a.label.localeCompare(b.label));
        map.set(provider, entries);
      }
    } catch {
      // Ignore parse errors and return empty catalog
    }

    return map;
  }

  /** Return first available model id for a provider */
  private getFirstModelForProvider(provider: string): string | null {
    const modelsByProvider = this.getModelCatalogByProvider();

    const normalizedProviderAliases: Record<string, string> = {
      "openai codex": "openai-codex",
      "google gemini": "gemini",
      "kimi coding": "kimi-coding",
      "kimi k2": "nvidia",
      glm5: "nvidia",
    };

    const normalizedProvider = normalizedProviderAliases[provider] ?? provider;
    const models = modelsByProvider.get(normalizedProvider) ?? [];
    return models[0]?.id ?? null;
  }

  /** Hardcoded fallback models for providers not yet in the catalog */
  private getDefaultModels(provider: string): ModelOption[] {
    const defaults: Record<string, ModelOption[]> = {
      "openai-codex": [
        { id: "openai-codex/gpt-5.3-codex", label: "GPT-5.3 Codex" },
        { id: "openai-codex/gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
        { id: "openai-codex/gpt-5.2-codex", label: "GPT-5.2 Codex" },
        { id: "openai-codex/gpt-5.2", label: "GPT-5.2" },
        { id: "openai-codex/gpt-5.1", label: "GPT-5.1" },
        { id: "openai-codex/gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
      ],
      openai: [
        { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
        { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex" },
        { id: "openai/gpt-5.2", label: "GPT-5.2" },
        { id: "openai/gpt-5.1-codex", label: "GPT-5.1 Codex" },
        { id: "openai/gpt-5", label: "GPT-5" },
        { id: "openai/o3", label: "o3" },
        { id: "openai/o4-mini", label: "o4-mini" },
      ],
    };
    return defaults[provider] ?? [];
  }

  /** Build a human-readable model label */
  private formatModelLabel(modelId: string, meta?: Record<string, unknown>): string {
    const alias = typeof meta?.alias === "string" ? meta.alias : "";
    const [, ...rest] = modelId.split("/");
    const shortId = rest.join("/") || modelId;
    return alias ? `${alias} (${shortId})` : shortId;
  }

  /** Read OpenClaw auth-profiles.json and extract configured providers */
  private getConfiguredProviders(): ProviderInfo[] {
    const providers: ProviderInfo[] = [];
    const activeModel = this.getActiveModel();
    const modelsByProvider = this.getModelCatalogByProvider();

    try {
      if (!existsSync(this.authProfilesPath)) {
        return providers;
      }

      const data: AuthProfilesFile = JSON.parse(readFileSync(this.authProfilesPath, "utf-8"));

      // Determine active profile per provider (prefer <provider>:default)
      const activeProfileByProvider = new Map<string, string>();
      for (const [profileId, profile] of Object.entries(data.profiles)) {
        if (!activeProfileByProvider.has(profile.provider)) {
          activeProfileByProvider.set(profile.provider, profileId);
        }
        if (profileId === `${profile.provider}:default`) {
          activeProfileByProvider.set(profile.provider, profileId);
        }
      }

      // Build provider info for each profile
      for (const [profileId, profile] of Object.entries(data.profiles)) {
        let maskedCredential = "";
        let mode = profile.type;
        let authType: "api-key" | "subscription" | "oauth" = "api-key";

        if (profile.token) {
          maskedCredential = this.maskCredential(profile.token);
          mode = "token";
          // Detect if it's a subscription token vs API key
          authType = this.detectAuthType(profileId, profile);
        } else if (profile.key) {
          maskedCredential = this.maskCredential(profile.key);
          mode = "api_key";
          authType = "api-key";
        } else if (profile.access) {
          maskedCredential = "OAuth connected";
          mode = "oauth";
          authType = "subscription";
        }

        if (maskedCredential) {
          // Active means: active model provider + active profile for that provider
          const isActive =
            activeModel?.provider === profile.provider &&
            activeProfileByProvider.get(profile.provider) === profileId;
          
          // Use custom name if available; otherwise include profile identifier to avoid duplicate labels
          const profileIdentifier = profileId.includes(":") ? profileId.split(":")[1] : profileId;
          const baseName = this.formatProviderName(profile.provider);
          const displayName = profile.customName || `${baseName} · ${profileIdentifier}`;

          providers.push({
            id: profileId, // Use the full profile ID for editing
            name: displayName,
            configured: true,
            mode,
            authType,
            maskedCredential,
            active: isActive,
            models: modelsByProvider.get(profile.provider) ?? this.getDefaultModels(profile.provider),
          });
        }
      }

      // Sort so active provider comes first, then by name
      providers.sort((a, b) => {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err) {
      console.warn(`[settings] Failed to read auth-profiles.json: ${err}`);
    }

    return providers;
  }

  /** Detect whether a profile uses API key or subscription auth */
  private detectAuthType(
    profileId: string,
    profile: AuthProfile
  ): "api-key" | "subscription" | "oauth" {
    // If has OAuth tokens, it's subscription/oauth
    if (profile.access || profile.refresh) {
      return "subscription";
    }

    // Check profile ID for hints
    const lowerProfileId = profileId.toLowerCase();
    if (lowerProfileId.includes("-sub") || lowerProfileId.includes("sub-")) {
      return "subscription";
    }

    // Check token format for Anthropic
    if (profile.provider === "anthropic" && profile.token) {
      // API keys: sk-ant-api03-...
      // OAuth tokens: sk-ant-oat-...
      // Setup tokens have different patterns
      if (profile.token.startsWith("sk-ant-api")) {
        return "api-key";
      }
      if (profile.token.startsWith("sk-ant-oat") || profile.token.startsWith("sk-ant-sid")) {
        return "subscription";
      }
    }

    // Check for OpenAI Codex (always subscription-based)
    if (profile.provider === "openai-codex") {
      return "subscription";
    }

    // Default to api-key
    return "api-key";
  }

  /** Mask a credential for display */
  private maskCredential(credential: string): string {
    if (credential.length <= 12) return "***";
    return credential.slice(0, 7) + "..." + credential.slice(-4);
  }

  /** Format provider name for display */
  private formatProviderName(provider: string): string {
    const names: Record<string, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      "openai-codex": "OpenAI Codex",
      gemini: "Google Gemini",
      google: "Google",
      "kimi-coding": "Kimi Coding",
      nvidia: "NVIDIA",
      ollama: "Ollama",
    };
    return names[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  /** Refresh settings state from disk (call periodically to detect external changes) */
  refreshSettingsState(): void {
    this.writeSettingsState();
    this.pushSettingsState();
    // Also refresh sessions
    this.listSessions();
  }

  /** List all active sessions with their current model */
  private listSessions(): void {
    try {
      const listResult = this.spawnClaw(
        ["gateway", "call", "sessions.list", "--params", '{"limit": 50}', "--json"],
      );

      if (listResult.status !== 0) {
        console.warn(`[settings] Failed to list sessions: ${listResult.stderr}`);
        return;
      }

      let rawSessions: Array<{
        key: string;
        kind: string;
        model?: string;
        modelProvider?: string;
        updatedAt?: number;
        agentId?: string;
        displayName?: string;
        origin?: { label?: string };
      }> = [];

      try {
        const parsed = JSON.parse(listResult.stdout);
        rawSessions = parsed.sessions || [];
      } catch {
        console.warn(`[settings] Failed to parse sessions list`);
        return;
      }

      const globalDefault = this.getActiveModel();
      const globalModelId = globalDefault
        ? `${globalDefault.provider}/${globalDefault.model}`
        : null;

      // Transform sessions for the UI
      const sessions = rawSessions
        .filter(s => s.kind === "direct") // Only show direct chat sessions
        .map(s => {
          // Combine modelProvider and model into full model ID
          const sessionModel = s.modelProvider && s.model 
            ? `${s.modelProvider}/${s.model}`
            : s.model || globalModelId;
          const isOverride = sessionModel !== globalModelId;
          
          return {
            key: s.key,
            label: this.formatSessionLabel(s.key, s.agentId, s.origin?.label, s.displayName),
            model: sessionModel,
            modelLabel: this.formatModelLabelFromId(sessionModel),
            isOverride,
            lastUpdated: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
          };
        })
        .sort((a, b) => {
          // Sort overrides first, then by last updated
          if (a.isOverride && !b.isOverride) return -1;
          if (!a.isOverride && b.isOverride) return 1;
          return 0;
        });

      // Write to state
      const statePath = resolve(this.stateDir, "sessions.json");
      const state = {
        version: Date.now(),
        timestamp: new Date().toISOString(),
        state: {
          sessions,
          globalModel: globalModelId,
        },
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
      this.store.setState("sessions", state);

    } catch (err) {
      console.warn(`[settings] Failed to list sessions: ${err}`);
    }
  }

  /** Format a session key into a human-readable label */
  private formatSessionLabel(
    key: string, 
    agentId?: string, 
    originLabel?: string,
    displayName?: string
  ): string {
    // Use origin label if available (e.g., "Robin Spottiswoode (@robin_blocks)")
    if (originLabel) {
      // Extract just the name part before any ID/handle info
      const namePart = originLabel.split(" (")[0].split(" @")[0].split(" id:")[0];
      if (namePart && namePart.length > 0 && namePart.length < 30) {
        return namePart;
      }
    }

    // Use display name if available
    if (displayName) {
      return displayName;
    }

    // Fall back to parsing the key
    const parts = key.split(":");
    
    if (parts[0] === "agent") {
      return agentId || parts[1] || key;
    }
    
    // Channel-based session
    const channelNames: Record<string, string> = {
      telegram: "Telegram",
      discord: "Discord",
      whatsapp: "WhatsApp",
      signal: "Signal",
      slack: "Slack",
      irc: "IRC",
    };
    
    return channelNames[parts[0]] || parts[0];
  }

  /** Format a model ID into a human-readable label */
  private formatModelLabelFromId(modelId: string | null): string {
    if (!modelId) return "Unknown";
    
    const aliases: Record<string, string> = {
      "anthropic/claude-opus-4-5": "Claude Opus 4.5",
      "anthropic/claude-opus-4-6": "Claude Opus 4.6",
      "anthropic/claude-sonnet-4-5": "Claude Sonnet 4.5",
      "openai-codex/gpt-5.3-codex": "Codex (GPT-5.3)",
      "openai/gpt-5.2": "GPT-5.2",
      "kimi-coding/k2p5": "Kimi K2.5",
    };
    
    return aliases[modelId] || modelId.split("/").pop() || modelId;
  }

  /** Reset a session's model override to use the global default */
  private resetSessionModel(sessionKey: string): void {
    const globalDefault = this.getActiveModel();
    if (!globalDefault) {
      console.warn(`[settings] No global default model configured`);
      return;
    }

    const modelId = `${globalDefault.provider}/${globalDefault.model}`;
    const [provider, ...rest] = modelId.split("/");
    const model = rest.join("/");

    try {
      const sessionsPath = resolve(
        this.openclawHome, ".openclaw", "agents", "main", "sessions", "sessions.json",
      );
      if (!existsSync(sessionsPath)) {
        console.warn(`[settings] Sessions file not found`);
        return;
      }

      const sessions = JSON.parse(readFileSync(sessionsPath, "utf-8"));
      const sess = sessions[sessionKey] as Record<string, unknown> | undefined;
      if (sess) {
        sess.modelProvider = provider;
        sess.model = model;
        writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), "utf-8");
        this.onConfigChanged?.();
        console.log(`[settings] Reset session "${sessionKey}" to ${modelId}`);
      } else {
        console.warn(`[settings] Session "${sessionKey}" not found in sessions file`);
      }
    } catch (err) {
      console.warn(`[settings] Failed to reset session "${sessionKey}": ${err}`);
    }

    // Push updated state immediately from disk
    this.writeSettingsState(true);
    this.pushSettingsState();
  }

  /** Apply the global default model to all active sessions */
  private applyDefaultToAllSessions(): void {
    const globalDefault = this.getActiveModel();
    if (!globalDefault) {
      console.warn(`[settings] No global default model configured`);
      return;
    }

    const modelId = `${globalDefault.provider}/${globalDefault.model}`;
    this.patchAllSessionModels(modelId);

    // Push updated state immediately — read sessions from disk (not gateway, which has stale cache)
    this.writeSettingsState(true);
    this.pushSettingsState();
  }

  /** Write settings.json state with provider status */
  writeSettingsState(fromDisk = false): void {
    const providers = this.getConfiguredProviders();
    const isConfigured = providers.length > 0;
    const activeModel = this.getActiveModel();

    // Find the active provider
    const activeProvider = providers.find((p) => p.active);

    // Get sessions data — fromDisk reads sessions file directly (use after local patches)
    const sessionsData = fromDisk ? this.getSessionsDataFromDisk() : this.getSessionsData();

    const state = {
      version: Date.now(),
      timestamp: new Date().toISOString(),
      state: {
        active: {
          isConfigured,
          provider: activeProvider?.name ?? null,
          profileId: activeProvider?.id ?? null,
          model: activeModel ? `${activeModel.provider}/${activeModel.model}` : null,
        },
        configuredProviders: providers,
        // Include sessions directly in settings state for component access
        sessions: sessionsData,
      },
    };

    const statePath = resolve(this.stateDir, "settings.json");
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  /** Get sessions data without writing to separate file */
  private getSessionsData(): { sessions: unknown[]; globalModel: string | null } {
    try {
      const listResult = this.spawnClaw(
        ["gateway", "call", "sessions.list", "--params", '{"limit": 50}', "--json"],
      );

      if (listResult.status !== 0) {
        return { sessions: [], globalModel: null };
      }

      let rawSessions: Array<{
        key: string;
        kind: string;
        model?: string;
        modelProvider?: string;
        updatedAt?: number;
        agentId?: string;
        displayName?: string;
        origin?: { label?: string };
      }> = [];

      try {
        const parsed = JSON.parse(listResult.stdout);
        rawSessions = parsed.sessions || [];
      } catch {
        return { sessions: [], globalModel: null };
      }

      const globalDefault = this.getActiveModel();
      const globalModelId = globalDefault 
        ? `${globalDefault.provider}/${globalDefault.model}` 
        : null;

      const sessions = rawSessions
        .filter(s => s.kind === "direct")
        .map(s => {
          const sessionModel = s.modelProvider && s.model 
            ? `${s.modelProvider}/${s.model}`
            : s.model || globalModelId;
          const isOverride = sessionModel !== globalModelId;
          
          return {
            key: s.key,
            label: this.formatSessionLabel(s.key, s.agentId, s.origin?.label, s.displayName),
            model: sessionModel,
            modelLabel: this.formatModelLabelFromId(sessionModel),
            isOverride,
            lastUpdated: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
          };
        })
        .sort((a, b) => {
          if (a.isOverride && !b.isOverride) return -1;
          if (!a.isOverride && b.isOverride) return 1;
          return 0;
        });

      return { sessions, globalModel: globalModelId };
    } catch {
      return { sessions: [], globalModel: null };
    }
  }

  /** Read sessions directly from the sessions file on disk (bypasses gateway cache) */
  private getSessionsDataFromDisk(): { sessions: unknown[]; globalModel: string | null } {
    try {
      const sessionsPath = resolve(
        this.openclawHome, ".openclaw", "agents", "main", "sessions", "sessions.json",
      );
      if (!existsSync(sessionsPath)) return { sessions: [], globalModel: null };

      const raw = JSON.parse(readFileSync(sessionsPath, "utf-8")) as Record<string, Record<string, unknown>>;
      const globalDefault = this.getActiveModel();
      const globalModelId = globalDefault
        ? `${globalDefault.provider}/${globalDefault.model}`
        : null;

      const sessions = Object.entries(raw)
        .filter(([key, sess]) => {
          const kind = sess.chatType ?? sess.kind;
          return kind === "direct" && !key.includes(":clapps-chat") && !key.includes(":clapps-title");
        })
        .map(([key, sess]) => {
          const mp = sess.modelProvider as string | undefined;
          const m = sess.model as string | undefined;
          const sessionModel = mp && m ? `${mp}/${m}` : (m || globalModelId);
          const isOverride = sessionModel !== globalModelId;
          const origin = sess.origin as { label?: string } | undefined;

          return {
            key,
            label: this.formatSessionLabel(key, sess.agentId as string | undefined, origin?.label, sess.displayName as string | undefined),
            model: sessionModel,
            modelLabel: this.formatModelLabelFromId(sessionModel ?? null),
            isOverride,
            lastUpdated: sess.updatedAt ? new Date(sess.updatedAt as number).toISOString() : undefined,
          };
        })
        .sort((a, b) => {
          if (a.isOverride && !b.isOverride) return -1;
          if (!a.isOverride && b.isOverride) return 1;
          return 0;
        });

      return { sessions, globalModel: globalModelId };
    } catch {
      return { sessions: [], globalModel: null };
    }
  }

  /** Push settings state to in-memory store */
  private pushSettingsState(): void {
    const statePath = resolve(this.stateDir, "settings.json");
    const content = readFileSync(statePath, "utf-8");
    this.store.setState("settings", JSON.parse(content));
  }

  /** Push _status state to in-memory store */
  private pushStatusState(): void {
    const statePath = resolve(this.stateDir, "_status.json");
    if (existsSync(statePath)) {
      const content = readFileSync(statePath, "utf-8");
      this.store.setState("_status", JSON.parse(content));
    }
  }
}
