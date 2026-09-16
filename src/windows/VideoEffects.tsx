import {useRef, useState} from "react";
import type {KeyboardEvent, PointerEvent} from "react";
import {Focus, Shield, Trash2, Play} from "lucide-react";
import {t} from "../i18n";
import {activeVideoEffects, clamp, createVideoEffect, moveVideoEffect, resizeVideoEffect, validVideoEffect} from "./video-effects";
import type {VideoEffect} from "./video-effects";
import "./video-effects.css";
import {VideoTimeInput} from "./VideoTimeInput";

export type VideoEffectsProps = {
  effects: VideoEffect[];
  onChange(effects: VideoEffect[], transient?: boolean): void;
  selectedId: string | null;
  onSelect(id: string | null): void;
  time: number;
  duration: number;
  disabled?: boolean;
  onSeek?(time: number): void;
};

export function VideoEffectsControls(props: VideoEffectsProps) {
  const [error, setError] = useState(false);
  const selected = props.effects.find(effect => effect.id === props.selectedId);
  function add(kind: VideoEffect["kind"]) {
    const effect = createVideoEffect(kind, props.time, props.duration, props.effects);
    if (!effect) {setError(true); return;}
    setError(false);
    props.onChange([...props.effects, effect]);
    props.onSelect(effect.id);
    props.onSeek?.(effect.start);
  }
  function update(next: VideoEffect) {
    if (!validVideoEffect(next, props.effects, props.duration)) {setError(true); return;}
    setError(false);
    props.onChange(props.effects.map(effect => effect.id === next.id ? next : effect));
  }
  return <section className="kiri-video-effects" aria-label={t("Video effects")}>
    <div className="kiri-video-effects-actions">
      <strong>{t("Video effects")}</strong>
      <button type="button" className="kiri-button kiri-button--secondary" disabled={props.disabled || props.duration < 0.05 || props.effects.length >= 128} onClick={() => add("zoom")}><Focus size={14}/>{t("Add zoom")}</button>
      <button type="button" className="kiri-button kiri-button--secondary" disabled={props.disabled || props.duration < 0.05 || props.effects.length >= 128} onClick={() => add("mask")}><Shield size={14}/>{t("Add privacy mask")}</button>
      {selected && <button type="button" className="kiri-button kiri-button--secondary" disabled={props.disabled} onClick={() => {props.onSelect(null); setError(false);}}><Play size={14}/>{t("Preview effects")}</button>}
    </div>
    {props.effects.length > 0 && <div className="kiri-video-effects-list" aria-label={t("Video effects")}>
      {props.effects.map((effect, index) => <button type="button" key={effect.id} className="kiri-video-effect-item" aria-pressed={effect.id === props.selectedId} disabled={props.disabled}
        onClick={() => {props.onSelect(effect.id); props.onSeek?.(effect.start); setError(false);}}>
        {effect.kind === "zoom" ? <Focus size={13}/> : <Shield size={13}/>}
        <span>{t(effect.kind === "zoom" ? "Zoom" : "Privacy mask")} {index + 1}</span>
        <span>{effect.start.toFixed(1)}–{effect.end.toFixed(1)} s</span>
      </button>)}
    </div>}
    {selected && <fieldset className="kiri-video-effect-fields" disabled={props.disabled}>
      <label>{t("Effect start")}<VideoTimeInput key={`${selected.id}-start`}  min={0} max={selected.end - 0.05} step={0.1} value={Number(selected.start.toFixed(3))} onCommit={start => update({...selected, start})}/></label>
      <label>{t("Effect end")}<VideoTimeInput key={`${selected.id}-end`}  min={selected.start + 0.05} max={props.duration} step={0.1} value={Number(selected.end.toFixed(3))} onCommit={end => update({...selected, end})}/></label>
      {selected.kind === "zoom" && <label>{t("Zoom scale")}<select value={(1 / selected.width).toFixed(2)} onChange={event => {
        const size = 1 / Number(event.target.value);
        update({...selected, width: size, height: size, x: clamp(selected.x + (selected.width - size) / 2, 0, 1 - size), y: clamp(selected.y + (selected.height - size) / 2, 0, 1 - size)});
      }}>
        {![1.5, 2, 2.5, 3, 4].some(value => value.toFixed(2) === (1 / selected.width).toFixed(2)) && <option value={(1 / selected.width).toFixed(2)}>{(1 / selected.width).toFixed(2)}×</option>}
        {[1.5, 2, 2.5, 3, 4].map(value => <option key={value} value={value.toFixed(2)}>{value}×</option>)}
      </select></label>}
      <button type="button" className="kiri-button kiri-button--secondary" onClick={() => {props.onChange(props.effects.filter(effect => effect.id !== selected.id)); props.onSelect(null); setError(false);}}><Trash2 size={14}/>{t("Delete effect")}</button>
      <p>{t("Drag the region to move it. Drag its corner to resize. Arrow keys adjust the focused region.")}</p>
      <p>{t("Editing shows the full source. Preview effects to see the exported framing.")}</p>
    </fieldset>}
    {error && <p className="kiri-video-effects-error" role="alert">{t("Use a valid time range. Zoom effects cannot overlap.")}</p>}
  </section>;
}

type Gesture = {id: string; x: number; y: number; width: number; height: number; mode: "move" | "resize"; original: VideoEffect[]; latest: VideoEffect[]};

export function VideoEffectsOverlay(props: VideoEffectsProps) {
  const layer = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const selected = props.effects.find(effect => effect.id === props.selectedId);
  if (!selected) return null;
  const visible = activeVideoEffects(props.effects, props.time);
  if (!visible.some(effect => effect.id === selected.id)) visible.push(selected);
  function begin(event: PointerEvent<HTMLElement>, effect: VideoEffect, mode: "move" | "resize") {
    if (props.disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = layer.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onSelect(effect.id);
    gesture.current = {id: effect.id, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, mode, original: props.effects, latest: props.effects};
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current;
    if (!state) return;
    const effect = state.original.find(item => item.id === state.id)!;
    const dx = (event.clientX - state.x) / state.width, dy = (event.clientY - state.y) / state.height;
    const next = state.mode === "move" ? moveVideoEffect(effect, dx, dy) : resizeVideoEffect(effect, dx, dy);
    state.latest = state.original.map(item => item.id === next.id ? next : item);
    props.onChange(state.latest, true);
  }
  function finish(cancel = false) {
    if (!gesture.current) return;
    props.onChange(cancel ? gesture.current.original : gesture.current.latest, false);
    gesture.current = null;
  }
  function keyboard(event: KeyboardEvent<HTMLElement>, effect: VideoEffect, resize: boolean) {
    if (props.disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 0.02 : 0.002;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const next = resize ? resizeVideoEffect(effect, dx, dy) : moveVideoEffect(effect, dx, dy);
    props.onChange(props.effects.map(item => item.id === next.id ? next : item));
  }
  return <div ref={layer} className="kiri-video-effects-overlay">
    {visible.map(effect => <div key={effect.id} role="button" tabIndex={props.disabled ? -1 : 0}
      aria-label={t(effect.kind === "zoom" ? "Move zoom region" : "Move privacy mask")}
      aria-pressed={effect.id === props.selectedId}
      className={`kiri-video-effect-region kiri-video-effect-region--${effect.kind}${effect.id === props.selectedId ? " is-selected" : ""}`}
      style={{left: `${effect.x * 100}%`, top: `${effect.y * 100}%`, width: `${effect.width * 100}%`, height: `${effect.height * 100}%`}}
      onPointerDown={event => begin(event, effect, "move")} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}
      onKeyDown={event => keyboard(event, effect, false)} onFocus={() => {if (!props.disabled) props.onSelect(effect.id);}}>
      <span className="kiri-video-effect-tag">{t(effect.kind === "zoom" ? "Zoom" : "Privacy mask")}</span>
      {effect.id === props.selectedId && <button type="button" className="kiri-video-effect-resize" disabled={props.disabled}
        aria-label={t("Resize effect region")} onPointerDown={event => begin(event, effect, "resize")} onPointerMove={event => {event.stopPropagation(); move(event);}} onPointerUp={event => {event.stopPropagation(); finish();}} onPointerCancel={event => {event.stopPropagation(); finish(true);}} onKeyDown={event => keyboard(event, effect, true)}/>}
    </div>)}
  </div>;
}
