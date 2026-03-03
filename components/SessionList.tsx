import { useEffect, useState } from "react";
import { useClappState, useIntent } from "@clapps/renderer";
import { cn } from "@/lib/utils";
import { RefreshCw, RotateCcw, Check, AlertTriangle, Loader2 } from "lucide-react";

interface Session {
  key: string;
  label: string;
  model: string | null;
  modelLabel: string;
  isOverride: boolean;
  lastUpdated?: string;
}

interface SessionsState {
  sessions: Session[];
  globalModel: string | null;
}

export function SessionList() {
  // Sessions data is now included directly in the settings state
  const sessionsData = useClappState<SessionsState>("sessions");
  const sessions = sessionsData?.sessions ?? [];
  const globalModel = sessionsData?.globalModel;
  
  const { emit } = useIntent();
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resettingSession, setResettingSession] = useState<string | null>(null);
  const [applyingToAll, setApplyingToAll] = useState(false);

  // Request initial session list on mount
  useEffect(() => {
    emit("settings.listSessions", {});
  }, [emit]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    emit("settings.listSessions", {});
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  const handleResetSession = (sessionKey: string) => {
    setResettingSession(sessionKey);
    emit("settings.resetSessionModel", { sessionKey });
    setTimeout(() => setResettingSession(null), 2000);
  };

  const handleApplyToAll = () => {
    setApplyingToAll(true);
    emit("settings.applyDefaultToAll", {});
    setTimeout(() => setApplyingToAll(false), 3000);
  };

  const overrideCount = sessions.filter(s => s.isOverride).length;
  const mainSession = sessions.find(s => s.key === "agent:main:main") ?? sessions[0];
  const mainIsOverride = Boolean(mainSession?.isOverride);

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Sessions</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            title="Refresh sessions"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </button>
        </div>
        <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-md">
          No active sessions found
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Sessions</p>
          <p className="text-sm text-muted-foreground">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            {overrideCount > 0 && (
              <span className="text-amber-500 ml-1">
                • {overrideCount} override{overrideCount !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          title="Refresh sessions"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </button>
      </div>

      {/* Source-of-truth summary */}
      <div className={cn(
        "rounded-lg border p-3 space-y-2",
        mainIsOverride ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-muted/30"
      )}>
        <div className="text-xs text-muted-foreground">Model source of truth</div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs">Global default</div>
            <div className="font-medium truncate">{globalModel ?? "unknown"}</div>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-muted-foreground text-xs">This session</div>
            <div className="font-medium truncate">{mainSession?.model ?? "unknown"}</div>
          </div>
        </div>
        {mainSession && (
          <div className="flex items-center justify-between">
            <span className={cn(
              "text-xs",
              mainIsOverride ? "text-amber-500" : "text-green-600 dark:text-green-400"
            )}>
              {mainIsOverride ? "Session override is active" : "Session matches global default"}
            </span>
            {mainIsOverride && (
              <button
                onClick={() => handleResetSession(mainSession.key)}
                disabled={resettingSession === mainSession.key}
                className="shrink-0 px-2 py-1 text-xs rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                {resettingSession === mainSession.key ? "Resetting…" : "Reset this session"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Session list */}
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <div
            key={session.key}
            className={cn(
              "flex items-start justify-between gap-2 p-3 rounded-lg border",
              session.isOverride
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-border bg-muted/30"
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {session.isOverride ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                ) : (
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                )}
                <span className="text-sm font-medium truncate">
                  {session.label}
                </span>
              </div>
              <div className="mt-1 ml-6">
                <span className="text-xs text-muted-foreground">
                  {session.modelLabel}
                </span>
                {session.isOverride && (
                  <span className="text-xs text-amber-500 ml-2">
                    (override)
                  </span>
                )}
              </div>
            </div>

            {session.isOverride && (
              <button
                onClick={() => handleResetSession(session.key)}
                disabled={resettingSession === session.key}
                className={cn(
                  "shrink-0 px-2 py-1 text-xs rounded-md border border-border",
                  "hover:bg-muted transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                title="Reset to system default"
              >
                {resettingSession === session.key ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Apply to all button */}
      {overrideCount > 0 && (
        <button
          onClick={handleApplyToAll}
          disabled={applyingToAll}
          className={cn(
            "w-full py-2 px-4 text-sm font-medium rounded-md",
            "border border-amber-500/50 text-amber-600 dark:text-amber-400",
            "hover:bg-amber-500/10 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {applyingToAll ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying to all sessions...
            </span>
          ) : (
            `Apply default to all ${overrideCount} override${overrideCount !== 1 ? "s" : ""}`
          )}
        </button>
      )}
    </div>
  );
}
