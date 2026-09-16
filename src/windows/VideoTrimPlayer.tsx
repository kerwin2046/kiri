import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause, RotateCcw } from "lucide-react";
import { api } from "../lib/ipc";
import { fmt, t } from "../i18n";
import { deletedRanges, nextPlayableTime, outputTime, splitSegment, timelineDuration, trimSegment, validSegments, videoTimeLabel, type VideoSegment } from "./video-trim.js";
import { useVideoThumbnails } from "./useVideoThumbnails";
import { VideoEffectsControls, VideoEffectsOverlay } from "./VideoEffects";
import type { VideoEffect } from "./video-effects";
import "./video-trim.css";
import {VideoTimeInput} from "./VideoTimeInput";

type EditDocument = { segments: VideoSegment[]; effects: VideoEffect[] };
const unchanged = (a: EditDocument, b: EditDocument) => JSON.stringify(a) === JSON.stringify(b);

export function VideoTrimPlayer(props: { id: string; src: string; editable: boolean; onError(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const previewing = useRef(false);
  const dragBase = useRef<EditDocument | null>(null);
  const history = useRef<{ past: EditDocument[]; future: EditDocument[] }>({past:[],future:[]});
  const [doc, setDoc] = useState<EditDocument>({segments:[],effects:[]});
  const docRef = useRef(doc); docRef.current=doc;
  const [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [sourceSize, setSourceSize] = useState({width:16,height:9});
  const [fitted, setFitted] = useState({width:1,height:1});
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  const [effectId, setEffectId] = useState<string | null>(null);
  const [preset, setPreset] = useState<"original" | "share" | "small">("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const {frames,failed:thumbnailFailed} = useVideoThumbnails(props.src,duration,editing);
  const {segments,effects} = doc;
  const selectedClip=segments[selected];
  const total=timelineDuration(segments);
  const valid=validSegments(segments,duration);
  const canSplit=splitSegment(segments,time)!==segments;

  const seek = useCallback((value:number) => {
    const player=video.current;
    if(!player || !Number.isFinite(value)) return;
    previewing.current=false; player.pause();
    const next=Math.max(0,Math.min(duration,value));
    player.currentTime=next; setTime(next);
  },[duration]);

  function apply(next: EditDocument, transient=false) {
    const previous=docRef.current;
    if(transient) { dragBase.current ??= previous; }
    else {
      const baseline=dragBase.current ?? previous;
      dragBase.current=null;
      if(!unchanged(baseline,next)) {
        history.current.past=[...history.current.past.slice(-99),baseline];
        history.current.future=[];
      }
    }
    docRef.current=next; setDoc(next);
    setSavedId(null); setError(false); previewing.current=false; video.current?.pause();
  }
  function undo(redo=false) {
    if(busy || dragBase.current) return;
    const from=redo ? history.current.future : history.current.past;
    const next=from.pop(); if(!next) return;
    (redo ? history.current.past : history.current.future).push(docRef.current);
    docRef.current=next; setDoc(next); setEffectId(null);
    setSelected(index=>Math.min(index,Math.max(0,next.segments.length-1)));
    setSavedId(null); setError(false); previewing.current=false; video.current?.pause();
  }
  function split() {
    if(busy) return;
    const next=splitSegment(docRef.current.segments,time);
    if(next===docRef.current.segments) return;
    apply({...docRef.current,segments:next});
    setSelected(Math.max(0,next.findIndex(s=>Math.abs(s.start-time)<0.001))); setEffectId(null);
  }
  function removeClip() {
    if(busy || !selectedClip) return;
    const next=segments.filter((_,index)=>index!==selected);
    apply({...docRef.current,segments:next});
    setSelected(Math.max(0,Math.min(selected,next.length-1)));
    setEffectId(null);
    const nextTime=nextPlayableTime(next,time); if(nextTime!=null) seek(nextTime);
  }
  function playEdit() {
    const player=video.current; if(!player || !valid || busy) return;
    if(!player.paused) {previewing.current=false;player.pause();return;}
    setEffectId(null);
    const next=nextPlayableTime(segments,player.currentTime) ?? segments[0].start;
    player.currentTime=next; previewing.current=true;
    void player.play().catch(()=>{previewing.current=false;});
  }
  function updatePlayback() {
    const player=video.current; if(!player) return;
    if(previewing.current) {
      const next=nextPlayableTime(docRef.current.segments,player.currentTime);
      if(next==null) {
        previewing.current=false; player.pause();
        player.currentTime=docRef.current.segments[docRef.current.segments.length-1]?.end ?? 0;
      } else if(next>player.currentTime+0.001) player.currentTime=next;
    }
    setTime(player.currentTime);
  }

  useEffect(()=>{
    if(!editing || !playing) return;
    let frame=0;
    const tick=()=>{updatePlayback();frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[editing,playing]);

  useEffect(()=>{
    const element=stage.current; if(!element) return;
    const observer=new ResizeObserver(()=>{
      const rect=element.getBoundingClientRect();
      const scale=Math.min(rect.width/sourceSize.width,rect.height/sourceSize.height);
      setFitted({width:Math.max(1,sourceSize.width*scale),height:Math.max(1,sourceSize.height*scale)});
    });
    observer.observe(element); return()=>observer.disconnect();
  },[sourceSize,editing]);

  // Preview compositing mirrors native export: privacy rectangles first, then zoom.
  useEffect(()=>{
    const player=video.current,output=canvas.current;
    if(!editing || effectId || !player || !output) return;
    const buffer=document.createElement("canvas");
    const scale=Math.min(1,1280/Math.max(sourceSize.width,sourceSize.height));
    buffer.width=output.width=Math.max(1,Math.round(sourceSize.width*scale));
    buffer.height=output.height=Math.max(1,Math.round(sourceSize.height*scale));
    const sourceCtx=buffer.getContext("2d"),ctx=output.getContext("2d");
    if(!sourceCtx || !ctx) return;
    let frame=0;
    const draw=()=>{
      cancelAnimationFrame(frame);
      const playable=nextPlayableTime(docRef.current.segments,player.currentTime);
      const inDeletedGap=previewing.current && (playable==null || playable>player.currentTime+0.001);
      if(player.readyState>=2 && !player.seeking && !inDeletedGap) {
        const active=effects.filter(e=>player.currentTime>=e.start && player.currentTime<e.end);
        sourceCtx.drawImage(player,0,0,buffer.width,buffer.height);
        sourceCtx.fillStyle="#000";
        active.filter(e=>e.kind==="mask").forEach(e=>sourceCtx.fillRect(Math.floor(e.x*buffer.width),Math.floor(e.y*buffer.height),Math.ceil((e.x+e.width)*buffer.width)-Math.floor(e.x*buffer.width),Math.ceil((e.y+e.height)*buffer.height)-Math.floor(e.y*buffer.height)));
        const zoom=active.find(e=>e.kind==="zoom");
        ctx.clearRect(0,0,output.width,output.height);
        if(zoom) ctx.drawImage(buffer,zoom.x*buffer.width,zoom.y*buffer.height,zoom.width*buffer.width,zoom.height*buffer.height,0,0,output.width,output.height);
        else ctx.drawImage(buffer,0,0);
      }
      if(!player.paused) frame=requestAnimationFrame(draw);
    };
    const events=["seeked","loadeddata","play","pause"];
    events.forEach(event=>player.addEventListener(event,draw)); draw();
    return()=>{cancelAnimationFrame(frame);events.forEach(event=>player.removeEventListener(event,draw));};
  },[editing,effectId,effects,sourceSize]);

  useEffect(()=>{
    if(!editing) return;
    const onKey=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(target.closest("input,select,textarea,[contenteditable=true]")) return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="z") {event.preventDefault();undo(event.shiftKey);}
      else if(event.code==="Space" && !target.closest("button")) {event.preventDefault();playEdit();}
      else if(event.key.toLowerCase()==="s" && !event.metaKey && !event.ctrlKey) {event.preventDefault();split();}
      else if((event.key==="Delete"||event.key==="Backspace") && !effectId) {event.preventDefault();removeClip();}
    };
    window.addEventListener("keydown",onKey); return()=>window.removeEventListener("keydown",onKey);
  });

  function dragHandle(event:PointerEvent<HTMLDivElement>,index:number,edge:"start"|"end") {
    if(busy || !track.current) return;
    event.preventDefault();event.stopPropagation();
    const target=event.currentTarget,rect=track.current.getBoundingClientRect();
    const baseline=docRef.current;
    setSelected(index);setEffectId(null);dragBase.current=baseline;
    target.setPointerCapture(event.pointerId);
    const move=(e:globalThis.PointerEvent)=>{
      const value=(e.clientX-rect.left)/rect.width*duration;
      const next=trimSegment(baseline.segments,index,edge,value,duration);
      apply({...baseline,segments:next},true);seek(next[index][edge]);
    };
    const finish=(e:globalThis.PointerEvent)=>{
      target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);
      if(target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      apply(docRef.current);
    };
    const cancel=(e:globalThis.PointerEvent)=>{docRef.current=baseline;finish(e);setDoc(baseline);};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);
  }

  async function saveCopy() {
    if(saving.current||!valid) return;
    saving.current=true;setBusy(true);setError(false);setSavedId(null);
    previewing.current=false;video.current?.pause();setEffectId(null);
    try {setSavedId(await api.exportVideoCopy(props.id,segments,effects,preset));}
    catch {setError(true);}
    finally {saving.current=false;setBusy(false);}
  }

  return <div className={`kiri-video-player ${editing ? "kiri-video-player--editing" : ""}`}>
    {editing && <header className="kiri-video-editor-heading">
      <div><strong>{t("Video editor")}</strong><span>{t("Your original recording stays unchanged.")}</span></div>
      <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{previewing.current=false;video.current?.pause();setEditing(false);}}>{t("Close editor")}</button>
    </header>}
    <div className="kiri-video-workspace">
      <div ref={stage} className="kiri-video-stage">
        <div className="kiri-video-surface" style={{width:fitted.width,height:fitted.height}}>
          <video ref={video} src={props.src} crossOrigin="anonymous" controls={!editing} autoPlay preload="metadata"
            style={{visibility:editing&&!effectId?"hidden":"visible"}}
            onLoadedMetadata={event=>{
              const player=event.currentTarget,value=player.duration;
              const d=Number.isFinite(value)?value:0;setDuration(d);
              setSourceSize({width:player.videoWidth||16,height:player.videoHeight||9});
              const initial={segments:d>0?[{start:0,end:d}]:[],effects:[]};docRef.current=initial;setDoc(initial);
            }}
            onTimeUpdate={updatePlayback} onSeeked={updatePlayback}
            onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{previewing.current=false;setPlaying(false);}}
            onError={props.onError} />
          {editing && !effectId && <canvas ref={canvas} className="kiri-video-effect-preview" aria-label={t("Edited video preview")} />}
          {editing && effectId && <VideoEffectsOverlay effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={setEffectId} time={time} duration={duration} disabled={busy} />}
        </div>
        {editing && <span className="kiri-video-view-label">{t(effectId?"Position the effect on the original frame":"Edited preview")}</span>}
      </div>
      {editing && <aside className="kiri-video-inspector"><VideoEffectsControls effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={id=>{video.current?.pause();previewing.current=false;setEffectId(id);}} time={time} duration={duration} disabled={busy} onSeek={seek} /></aside>}
    </div>
    {props.editable&&!editing&&<button type="button" className="kiri-button kiri-button--secondary kiri-video-edit-entry" disabled={duration<=0} onClick={()=>{video.current?.pause();setEditing(true);}}><Scissors size={14}/>{t("Trim & Export")}</button>}
    {editing&&<section className="kiri-video-timeline" aria-label={t("Video timeline")}>
      <div className="kiri-video-edit-tools">
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!valid||busy} onClick={playEdit} title={t("Play edited video · Space")}>{playing?<Pause size={14}/>:<Play size={14}/>} {t(playing?"Pause":"Preview edit")}</button>
        <span className="kiri-video-clock">{videoTimeLabel(outputTime(segments,time))}<span> / {videoTimeLabel(total)}</span></span>
        <div className="kiri-video-tool-divider"/>
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!canSplit||busy} onClick={split} title={t("Split at playhead · S")}><Scissors size={14}/>{t("Split")}</button>
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!selectedClip||busy} onClick={removeClip}><Trash2 size={14}/>{t("Delete segment")}</button>
        <div className="kiri-video-history">
          <button type="button" className="kiri-button kiri-button--secondary" disabled={!history.current.past.length||busy} onClick={()=>undo()} title={t("Undo")} aria-label={t("Undo")}><Undo2 size={14}/></button>
          <button type="button" className="kiri-button kiri-button--secondary" disabled={!history.current.future.length||busy} onClick={()=>undo(true)} title={t("Redo")} aria-label={t("Redo")}><Redo2 size={14}/></button>
          <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{apply({segments:[{start:0,end:duration}],effects:[]});setSelected(0);setEffectId(null);seek(0);}} title={t("Reset edit")} aria-label={t("Reset edit")}><RotateCcw size={14}/></button>
        </div>
      </div>
      <div className="kiri-video-ruler">
        {Array.from({length:6},(_,i)=><span key={i}>{videoTimeLabel(duration*i/5)}</span>)}
        <input type="range" min={0} max={duration} step="any" value={time} disabled={busy} aria-label={t("Playhead")} aria-valuetext={videoTimeLabel(time)} onChange={e=>seek(Number(e.target.value))}/>
      </div>
      <div ref={track} className="kiri-video-track" onClick={event=>{
        if(busy||!track.current)return;const rect=track.current.getBoundingClientRect();seek((event.clientX-rect.left)/rect.width*duration);
      }}>
        <div className="kiri-video-filmstrip" aria-hidden="true">{Array.from({length:12},(_,index)=><div key={index}>{frames[index]&&<img src={frames[index]} draggable={false} alt=""/>}</div>)}</div>
        {deletedRanges(segments,duration).map((gap,i)=><div key={`gap-${i}`} className="kiri-video-removed" style={{left:`${gap.start/duration*100}%`,width:`${(gap.end-gap.start)/duration*100}%`}}/>)}
        {segments.map((clip,index)=><div key={index} className="kiri-video-clip" data-selected={index===selected} style={{left:`${clip.start/duration*100}%`,width:`${(clip.end-clip.start)/duration*100}%`}}>
          <button type="button" className="kiri-video-clip-select" disabled={busy} aria-pressed={index===selected} aria-label={fmt("Segment %d: %@ to %@",index+1,videoTimeLabel(clip.start),videoTimeLabel(clip.end))} onClick={event=>{
            event.stopPropagation();setSelected(index);setEffectId(null);const rect=track.current!.getBoundingClientRect();seek(event.detail===0?clip.start:Math.min(clip.end,Math.max(clip.start,(event.clientX-rect.left)/rect.width*duration)));
          }}><span>{String(index+1).padStart(2,"0")}</span></button>
          {(["start","end"] as const).map(edge=><div key={edge} className={`kiri-video-trim-handle kiri-video-trim-handle--${edge}`} role="slider" tabIndex={busy?-1:0} aria-label={fmt(edge==="start"?"Segment %d start":"Segment %d end",index+1)} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={clip[edge]} aria-valuetext={videoTimeLabel(clip[edge])} onPointerDown={event=>dragHandle(event,index,edge)} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
            if(busy||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const next=trimSegment(segments,index,edge,clip[edge]+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1),duration);apply({...docRef.current,segments:next});seek(next[index][edge]);
          }}/>) }
        </div>)}
        <div className="kiri-video-playhead" style={{left:`${duration?time/duration*100:0}%`}}><span/></div>
      </div>
      <div className="kiri-video-timeline-detail">
        <span>{thumbnailFailed?t("Thumbnails unavailable; editing still works."):fmt("%d segments · Source %@",segments.length,videoTimeLabel(duration))}</span>
        {selectedClip&&<div className="kiri-video-clip-fields"><span>{fmt("Segment %d",selected+1)}</span>{(["start","end"] as const).map(edge=><label key={edge}>{t(edge==="start"?"In":"Out")}<VideoTimeInput key={`${selected}-${edge}`}  min={0} max={duration} step={.1} disabled={busy} aria-label={t(edge==="start"?"Start time in seconds":"End time in seconds")} value={Number(selectedClip[edge].toFixed(3))} onCommit={value=>{const next=trimSegment(segments,selected,edge,value,duration);apply({...docRef.current,segments:next});seek(next[selected][edge]);}}/></label>)}</div>}
      </div>
      <footer className="kiri-video-export-footer">
        <div className="kiri-video-export-status" role={error?"alert":"status"}>{busy?t("Saving a new video to your library…"):error?t("Couldn't export the video. Check library access and free disk space, then retry."):savedId?<>{t("Copy saved to library")}<button type="button" className="kiri-button kiri-button--secondary" onClick={()=>void api.openAsset(savedId).catch(()=>setError(true))}>{t("Open")}</button></>:t("Click to seek. Drag clip edges to trim. Split to remove a middle section.")}</div>
        <label className="kiri-video-quality"><span>{t("Export quality")}</span><select disabled={busy} value={preset} onChange={e=>{setPreset(e.target.value as typeof preset);setSavedId(null);}}><option value="original">{t("High quality")}</option><option value="share">{t("Share · 1080 px max edge")}</option><option value="small">{t("Small file · 720 px max edge")}</option></select></label>
        <button type="button" className="kiri-button kiri-button--primary" disabled={!valid||busy} onClick={()=>void saveCopy()}>{t(busy?"Exporting…":"Save a Copy")}</button>
      </footer>
    </section>}
  </div>;
}
