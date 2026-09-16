import {useEffect, useRef, useState, type RefObject} from "react";
import {Play, Pause, Volume2, VolumeX, Maximize, Minimize, Check} from "lucide-react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {t} from "../i18n";
import {videoTimeLabel} from "./video-trim.js";
import "./video-playback.css";

const RATE_KEY = "kiri.video.playback-rate";
function savedRate() {
  try {const n=Number(localStorage.getItem(RATE_KEY)); return Number.isFinite(n)&&n>=.1&&n<=8?n:1;}
  catch {return 1;}
}

export function VideoPlaybackControls({video}: {video: RefObject<HTMLVideoElement | null>}) {
  const [playing,setPlaying]=useState(false), [time,setTime]=useState(0), [duration,setDuration]=useState(0);
  const [volume,setVolume]=useState(1), [muted,setMuted]=useState(false), [rate,setRate]=useState(savedRate);
  const [open,setOpen]=useState(false), [draft,setDraft]=useState(String(rate)), [fullscreen,setFullscreen]=useState(false);
  const panel=useRef<HTMLDivElement>(null), speedButton=useRef<HTMLButtonElement>(null), input=useRef<HTMLInputElement>(null);
  const valid=Number.isFinite(Number(draft))&&Number(draft)>=.1&&Number(draft)<=8;
  useEffect(()=>{
    const player=video.current; if(!player) return;
    player.playbackRate=savedRate();
    const sync=()=>{
      setPlaying(!player.paused);setTime(player.currentTime);
      setDuration(Number.isFinite(player.duration)?player.duration:0);
      setVolume(player.volume);setMuted(player.muted);setRate(player.playbackRate);
    };
    const events=["timeupdate","loadedmetadata","play","pause","ended","volumechange","ratechange"];
    events.forEach(name=>player.addEventListener(name,sync));sync();
    return()=>events.forEach(name=>player.removeEventListener(name,sync));
  },[video]);
  useEffect(()=>{
    if(!open)return;
    input.current?.focus();input.current?.select();
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener("pointerdown",outside);
    return()=>document.removeEventListener("pointerdown",outside);
  },[open]);
  useEffect(()=>{
    let disposed=false;
    const window=getCurrentWindow();
    const sync=()=>void window.isFullscreen().then(value=>{if(!disposed)setFullscreen(value);}).catch(()=>{});
    sync();const listener=window.onResized(sync);
    return()=>{disposed=true;void listener.then(unlisten=>unlisten()).catch(()=>{});};
  },[]);
  function togglePlay(){const player=video.current;if(!player)return;if(player.paused)void player.play().catch(()=>{});else player.pause();}
  function changeRate(value:number){
    if(!video.current||!Number.isFinite(value)||value<.1||value>8)return;
    video.current.playbackRate=value;setRate(value);setDraft(String(value));setOpen(false);speedButton.current?.focus();
    try{localStorage.setItem(RATE_KEY,String(value));}catch{/* Playback remains available without storage. */}
  }
  useEffect(()=>{
    const keyboard=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement).closest("input,button,select,textarea,[contenteditable=true]"))return;
      const player=video.current;if(!player)return;
      if(event.code==="Space"){event.preventDefault();togglePlay();}
      if(event.key==="ArrowLeft"||event.key==="ArrowRight"){
        event.preventDefault();player.currentTime=Math.min(Number.isFinite(player.duration)?player.duration:0,Math.max(0,player.currentTime+(event.key==="ArrowRight"?5:-5)));
      }
    };
    window.addEventListener("keydown",keyboard);return()=>window.removeEventListener("keydown",keyboard);
  },[video]);
  return <section className="kiri-playback-controls" aria-label={t("Playback controls")} onKeyDown={event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopPropagation();setOpen(false);speedButton.current?.focus();}
  }}>
    <input className="kiri-playback-seek" type="range" min={0} max={duration||1} step="any" value={time} disabled={!duration}
      aria-label={t("Playback position")} aria-valuetext={videoTimeLabel(time)} onChange={event=>{if(video.current)video.current.currentTime=Number(event.target.value);}}/>
    <div className="kiri-playback-row">
      <button type="button" className="kiri-icon-button" disabled={!duration} onClick={togglePlay} aria-label={t(playing?"Pause":"Play")} title={t(playing?"Pause":"Play")}>
        {playing?<Pause size={18}/>:<Play size={18}/>}</button>
      <span className="kiri-playback-time">{videoTimeLabel(time)}<span> / {videoTimeLabel(duration)}</span></span>
      <div className="kiri-playback-spacer"/>
      <div className="kiri-playback-volume">
        <button type="button" className="kiri-icon-button" onClick={()=>{if(video.current)video.current.muted=!video.current.muted;}} aria-label={t(muted?"Unmute":"Mute")} title={t(muted?"Unmute":"Mute")}>
          {muted||volume===0?<VolumeX size={17}/>:<Volume2 size={17}/>}</button>
        <input type="range" min={0} max={1} step={.01} value={muted?0:volume} aria-label={t("Volume")} onChange={event=>{if(video.current){video.current.volume=Number(event.target.value);video.current.muted=false;}}}/>
      </div>
      <div ref={panel} className="kiri-playback-speed">
        <button ref={speedButton} type="button" className="kiri-button kiri-button--secondary kiri-playback-rate" aria-label={t("Playback speed")} aria-expanded={open} aria-haspopup="dialog"
          onClick={()=>{setDraft(String(rate));setOpen(value=>!value);}}>{rate}×</button>
        {open&&<div className="kiri-playback-speed-panel" role="dialog" aria-label={t("Playback speed")}>
          <div className="kiri-playback-speed-heading"><strong>{t("Playback speed")}</strong><span>{rate}×</span></div>
          <div className="kiri-playback-presets">{[.5,.75,1,1.25,1.5,2].map(value=><button type="button" className="kiri-playback-preset" aria-pressed={rate===value} key={value} onClick={()=>changeRate(value)}>
            {value}×{rate===value&&<Check size={12}/>}</button>)}</div>
          <label className="kiri-playback-custom-label" htmlFor="kiri-custom-playback-rate">{t("Custom speed")}</label>
          <form className="kiri-playback-custom" onSubmit={event=>{event.preventDefault();if(valid)changeRate(Number(draft));}}>
            <div><input ref={input} id="kiri-custom-playback-rate" type="number" min={.1} max={8} step="any" value={draft} onChange={event=>setDraft(event.target.value)} aria-describedby="kiri-playback-rate-hint"/><span>×</span></div>
            <button type="submit" className="kiri-button kiri-button--primary" disabled={!valid}>{t("Apply")}</button>
          </form>
          <p id="kiri-playback-rate-hint">{t("0.1–8× · Remembered for playback only")}</p>
        </div>}
      </div>
      <button type="button" className="kiri-icon-button" aria-label={t(fullscreen?"Exit full screen":"Full screen")} title={t(fullscreen?"Exit full screen":"Full screen")} onClick={()=>{
        const window=getCurrentWindow();void window.isFullscreen().then(value=>window.setFullscreen(!value)).catch(()=>{});
      }}>{fullscreen?<Minimize size={17}/>:<Maximize size={17}/>}</button>
    </div>
  </section>;
}
