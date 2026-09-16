import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

type Level = { device: string; level: number };

/** An explicit five-second check; no samples are retained or written to disk. */
export default function MicrophoneCheck() {
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<Level | null>(null);
  const [status, setStatus] = useState<"idle" | "heard" | "silent" | "failed">("idle");
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void invoke("stop_microphone_check").catch(() => {});
    };
  }, []);

  const check = async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setStatus("idle");
    setSample(null);
    let heard = false;
    const channel = new Channel<Level>();
    channel.onmessage = (value) => {
      if (!alive.current) return;
      heard ||= value.level > 0.1;
      setSample(value);
    };
    try {
      await invoke("microphone_check", { onLevel: channel });
      if (alive.current) setStatus(heard ? "heard" : "silent");
    } catch {
      if (alive.current) setStatus("failed");
    } finally {
      busy.current = false;
      if (alive.current) {
        setRunning(false);
        setSample((value) => value && { ...value, level: 0 });
      }
    }
  };

  return (
    <div style={{ padding: "0 11px 10px", fontSize: 10, color: "rgba(255,255,255,0.72)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span title={sample?.device} style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {sample?.device ?? t("System default microphone")}
        </span>
        <button type="button" className="kiri-button kiri-button--secondary" disabled={running} onClick={() => void check()} style={{ padding: "3px 6px", font: "inherit", minHeight: 24 }}>
          {running ? t("Listening…") : t("Check microphone")}
        </button>
      </div>
      <div role="meter" aria-label={t("Microphone level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((sample?.level ?? 0) * 100)} style={{ height: 4, marginTop: 6, background: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${(sample?.level ?? 0) * 100}%`, height: "100%", background: "#fff" }} />
      </div>
      <div role="status" style={{ marginTop: 5, lineHeight: 1.4 }}>
        {running ? t("Speak for five seconds. Nothing is saved.") : status === "heard" ? t("Sound detected") : status === "silent" ? t("No sound detected. Check your input and try again.") : status === "failed" ? t("Microphone check failed. Check device access in system settings.") : t("Check your input before recording.")}
      </div>
    </div>
  );
}
