import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause, RotateCcw, X, Pencil } from "lucide-react";
import { api } from "../lib/ipc";
import { fmt, t } from "../i18n";
import { deletedRanges, nextPlayableTime, outputTime, splitSegment, timelineDuration, trimSegment, validSegments, videoTimeLabel, type VideoSegment } from "./video-trim.js";
import { useVideoThumbnails } from "./useVideoThumbnails";
import { VideoEffectsControls, VideoEffectsOverlay } from "./VideoEffects";
import type { VideoEffect } from "./video-effects";
import "./video-trim.css";
import {VideoEffectTracks} from "./VideoEffectTracks";
import {VideoPlaybackControls} from "./VideoPlaybackControls";
import {VideoTimeInput} from "./VideoTimeInput";

import type {AnnotationMark} from "../annotation/model";
import {VideoAnnotationsEditor} from "./VideoAnnotationsEditor";
import {renderVideoAnnotations,rasterizeVideoAnnotations} from "./video-annotation-render";
type VideoAnnotationTrack = {id:string;start:number;end:number;mark:AnnotationMark};
type EditDocument = { segments: VideoSegment[]; effects: VideoEffect[]; annotations:VideoAnnotationTrack[] };
const annotationLabel=(mark:AnnotationMark)=>t(({pen:"Pen",rectangle:"Rectangle",line:"Line",arrow:"Arrow",text:"Text",mosaic:"Mosaic"} as const)[mark.kind]);
const unchanged = (a: EditDocument, b: EditDocument) => JSON.stringify(a) === JSON.stringify(b);

export function VideoTrimPlayer(props: { id: string; src: string; editable: boolean; onClose(): void; onError(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const commitAnnotation = useRef<(() => void) | null>(null);
  const registerAnnotationCommit = useCallback((commit:(()=>void)|null)=>{commitAnnotation.current=commit;},[]);
  const previewing = useRef(false);
  const dragBase = useRef<EditDocument | null>(null);
  const history = useRef<{ past: EditDocument[]; future: EditDocument[] }>({past:[],future:[]});
  const [doc, setDoc] = useState<EditDocument>({segments:[],effects:[],annotations:[]});
  const docRef = useRef(doc); docRef.current=doc;
  const [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [sourceSize, setSourceSize] = useState({width:16,height:9});
  const [fitted, setFitted] = useState({width:1,height:1});
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(0);
  const [annotating,setAnnotating]=useState(false);
  const [annotationId,setAnnotationId]=useState<string|null>(null);
  const [annotationRevision,setAnnotationRevision]=useState(0);
  const [annotationToolbar,setAnnotationToolbar]=useState<HTMLDivElement|null>(null);
  const [sourceImage,setSourceImage]=useState<HTMLImageElement|null>(null);
  const [effectId, setEffectId] = useState<string | null>(null);
  const [preset, setPreset] = useState<"original" | "share" | "small">("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const {frames,failed:thumbnailFailed} = useVideoThumbnails(props.src,duration,editing);
  const {segments,effects,annotations} = doc;
  const selectedAnnotation=annotations.find(item=>item.id===annotationId);
  const visibleAnnotations=annotations.filter(item=>(time>=item.start&&time<item.end)||item.id===annotationId);
  const timelineItems=[...effects,...annotations.map(item=>({id:item.id,kind:"mask" as const,start:item.start,end:item.end,x:0,y:0,width:1,height:1}))];
  const trackLabels=Object.fromEntries(annotations.map(item=>[item.id,annotationLabel(item.mark)]));
  const selectedClip=segments[selected];
  const total=timelineDuration(segments);
  const valid=validSegments(segments,duration);
  const canSplit=splitSegment(segments,time)!==segments;

  const seek = useCallback((value:number) => {
    const player=video.current;
    if(!player || !Number.isFinite(value)) return;
    commitAnnotation.current?.();
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
    commitAnnotation.current?.();
    const from=redo ? history.current.future : history.current.past;
    const next=from.pop(); if(!next) return;
    (redo ? history.current.past : history.current.future).push(docRef.current);
    docRef.current=next; setDoc(next); setEffectId(null);setAnnotationRevision(value=>value+1);
    setSelected(index=>Math.min(index,Math.max(0,next.segments.length-1)));
    setSavedId(null); setError(false); previewing.current=false; video.current?.pause();
  }
  function split() {
    if(busy) return;
    commitAnnotation.current?.();
    const next=splitSegment(docRef.current.segments,time);
    if(next===docRef.current.segments) return;
    apply({...docRef.current,segments:next});
    setSelected(Math.max(0,next.findIndex(s=>Math.abs(s.start-time)<0.001))); setEffectId(null);
  }
  function removeClip() {
    if(busy || !selectedClip) return;
    commitAnnotation.current?.();
    const next=docRef.current.segments.filter((_,index)=>index!==selected);
    apply({...docRef.current,segments:next});
    setSelected(Math.max(0,Math.min(selected,next.length-1)));
    setEffectId(null);
    const nextTime=nextPlayableTime(next,time); if(nextTime!=null) seek(nextTime);
  }
  function playEdit() {
    const player=video.current; if(!player || !valid || busy) return;
    if(!player.paused) {previewing.current=false;player.pause();return;}
    commitAnnotation.current?.();
    setEffectId(null);setAnnotating(false);
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
      const availableHeight=Math.max(1,rect.height-(editing?32:0));
      const scale=Math.min(rect.width/sourceSize.width,availableHeight/sourceSize.height);
      setFitted({width:Math.max(1,sourceSize.width*scale),height:Math.max(1,sourceSize.height*scale)});
    });
    observer.observe(element); return()=>observer.disconnect();
  },[sourceSize,editing]);

  // Preview compositing mirrors native export: privacy rectangles first, then zoom.
  useEffect(()=>{
    const player=video.current,output=canvas.current;
    if(!editing || effectId || annotating || !player || !output) return;
    const buffer=document.createElement("canvas");
    const scale=Math.min(1,1280/Math.max(sourceSize.width,sourceSize.height));
    buffer.width=output.width=Math.max(1,Math.round(sourceSize.width*scale));
    buffer.height=output.height=Math.max(1,Math.round(sourceSize.height*scale));
    const sourceFrame=document.createElement("canvas");sourceFrame.width=sourceSize.width;sourceFrame.height=sourceSize.height;
    const frameCtx=sourceFrame.getContext("2d");
    const sourceCtx=buffer.getContext("2d"),ctx=output.getContext("2d");
    if(!sourceCtx || !ctx || !frameCtx) return;
    let frame=0;
    const draw=()=>{
      cancelAnimationFrame(frame);
      const playable=nextPlayableTime(docRef.current.segments,player.currentTime);
      const inDeletedGap=previewing.current && (playable==null || playable>player.currentTime+0.001);
      if(player.readyState>=2 && !player.seeking && !inDeletedGap) {
        const active=effects.filter(e=>player.currentTime>=e.start && player.currentTime<e.end);
        frameCtx.drawImage(player,0,0,sourceSize.width,sourceSize.height);
        sourceCtx.save();sourceCtx.scale(buffer.width/sourceSize.width,buffer.height/sourceSize.height);
        renderVideoAnnotations(sourceCtx,sourceFrame,annotations.filter(item=>player.currentTime>=item.start&&player.currentTime<item.end).map(item=>item.mark),sourceSize);
        sourceCtx.restore();
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
  },[editing,effectId,annotating,effects,annotations,sourceSize]);

  useEffect(()=>{
    if(!editing||annotating) return;
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
    commitAnnotation.current?.();
    const baseline=docRef.current;
    setSelected(index);setEffectId(null);setAnnotating(false);dragBase.current=baseline;
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
    commitAnnotation.current?.();
    const snapshot=docRef.current;
    saving.current=true;setBusy(true);setError(false);setSavedId(null);setAnnotating(false);
    previewing.current=false;video.current?.pause();setEffectId(null);
    try {await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));const rasterized=await rasterizeVideoAnnotations(snapshot.annotations,sourceSize);setSavedId(await api.exportVideoCopy(props.id,snapshot.segments,snapshot.effects,rasterized,preset));}
    catch {setError(true);}
    finally {saving.current=false;setBusy(false);}
  }

  useEffect(()=>{
    if(!annotating)return;
    setAnnotationRevision(value=>value+1);
    const player=video.current;if(!player)return;
    let disposed=false;
    const capture=()=>{
      if(player.readyState<2||player.seeking)return;
      const bitmap=document.createElement("canvas");bitmap.width=sourceSize.width;bitmap.height=sourceSize.height;
      const ctx=bitmap.getContext("2d");if(!ctx)return;ctx.drawImage(player,0,0);
      const image=new Image();image.onload=()=>{if(!disposed)setSourceImage(image);};image.src=bitmap.toDataURL("image/png");
    };
    capture();player.addEventListener("seeked",capture);
    return()=>{disposed=true;player.removeEventListener("seeked",capture);};
  },[annotating,time,sourceSize]);
  function changeAnnotationMarks(marks:AnnotationMark[]){
    const current=docRef.current;
    const visibleIds=new Set(visibleAnnotations.map(item=>item.mark.id));
    const incoming=new Map(marks.map(mark=>[mark.id,mark]));
    const retained=current.annotations.flatMap(item=>{
      if(!visibleIds.has(item.mark.id))return [item];
      const mark=incoming.get(item.mark.id);return mark?[{...item,mark}]:[];
    });
    const existing=new Set(current.annotations.map(item=>item.mark.id));
    const start=Math.max(0,Math.min(time,duration-.05));
    const added=marks.filter(mark=>!existing.has(mark.id)).map(mark=>({id:`annotation-${mark.id}`,mark,start,end:Math.min(duration,start+3)}));
    if(retained.length+added.length>128){setAnnotationRevision(value=>value+1);setError(true);return;}
    apply({...current,annotations:[...retained,...added]});
    if(added.length)setAnnotationId(added[added.length-1].id);
  }
  function selectTrack(id:string){
    commitAnnotation.current?.();
    setAnnotationRevision(value=>value+1);
    if(id.startsWith("annotation-")){setAnnotationId(id);setEffectId(null);setAnnotating(true);}
    else{setAnnotating(false);setAnnotationId(null);setEffectId(id);}
  }
  function changeTracks(next:VideoEffect[],transient=false){
    if(!dragBase.current)commitAnnotation.current?.();
    if(!transient)setAnnotationRevision(value=>value+1);
    const byId=new Map(next.map(item=>[item.id,item]));
    apply({...docRef.current,effects:next.filter(item=>!item.id.startsWith("annotation-")),annotations:docRef.current.annotations.map(item=>{
      const timing=byId.get(item.id);return timing?{...item,start:timing.start,end:timing.end}:item;
    })},transient);
  }

  return <div className={`kiri-video-player ${editing ? "kiri-video-player--editing" : ""}`}>
    <header className="kiri-video-editor-heading">
      <div><strong>{t(editing ? "Video editor" : "Video")}</strong><span>{t(editing ? "Your original recording stays unchanged." : "Esc to close")}</span></div>
      <div className="kiri-video-header-actions">
        {editing&&<button type="button" className="kiri-button kiri-button--secondary" disabled={busy} aria-pressed={annotating} onClick={()=>{commitAnnotation.current?.();video.current?.pause();previewing.current=false;setEffectId(null);setAnnotating(value=>!value);}}><Pencil size={14}/>{t("Annotate video")}</button>}
        {editing ? <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();previewing.current=false;video.current?.pause();setEditing(false);setAnnotating(false);}}>{t("Close editor")}</button>
          : props.editable && <button type="button" className="kiri-button kiri-button--primary" disabled={duration<=0} onClick={()=>{video.current?.pause();setEditing(true);}}><Scissors size={14}/>{t("Trim & Export")}</button>}
        <button type="button" className="kiri-icon-button" aria-label={t("Close · Esc")} title={t("Close · Esc")} onClick={props.onClose}><X size={16}/></button>
      </div>
    </header>
    {editing&&annotating&&<div ref={setAnnotationToolbar} className="kiri-video-annotation-toolbar-host"/>}
    <div className="kiri-video-workspace">
      <div ref={stage} className="kiri-video-stage">
        <div className="kiri-video-surface" style={{width:fitted.width,height:fitted.height}}>
          <video ref={video} src={props.src} crossOrigin="anonymous" controls={false} playsInline autoPlay preload="metadata"
            style={{visibility:editing&&!effectId?"hidden":"visible"}}
            onLoadedMetadata={event=>{
              const player=event.currentTarget,value=player.duration;
              const d=Number.isFinite(value)?value:0;setDuration(d);
              setSourceSize({width:player.videoWidth||16,height:player.videoHeight||9});
              const initial={segments:d>0?[{start:0,end:d}]:[],effects:[],annotations:[]};docRef.current=initial;setDoc(initial);
            }}
            onTimeUpdate={updatePlayback} onSeeked={updatePlayback}
            onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{previewing.current=false;setPlaying(false);}}
            onError={props.onError} />
          {editing && !effectId && !annotating && <canvas ref={canvas} className="kiri-video-effect-preview" aria-label={t("Edited video preview")} />}
          {editing&&annotating&&<div className="kiri-video-annotation-editor"><VideoAnnotationsEditor onCommitReady={registerAnnotationCommit} toolbarHost={annotationToolbar} image={sourceImage} sourceSize={sourceSize} viewSize={fitted} marks={visibleAnnotations.map(item=>item.mark)} revision={annotationRevision} selectedMarkId={selectedAnnotation?.mark.id??null} onSelectionChange={markId=>setAnnotationId(markId===null?null:docRef.current.annotations.find(item=>item.mark.id===markId)?.id??null)} disabled={busy} onChange={changeAnnotationMarks} onUndo={()=>undo()} onRedo={()=>undo(true)} canUndo={!!history.current.past.length} canRedo={!!history.current.future.length} onClose={()=>setAnnotating(false)}/></div>}
          {editing && effectId && <VideoEffectsOverlay effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={setEffectId} time={time} duration={duration} disabled={busy} />}
        </div>
        {editing && <span className="kiri-video-view-label">{t(effectId||annotating?"Position the effect on the original frame":"Edited preview")}</span>}
      </div>
      {editing && <aside className="kiri-video-inspector">{annotating?<section className="kiri-video-annotation-inspector"><strong>{t("Annotation timing")}</strong>
        <p>{t("Each annotation has its own track. Drag its edges to set when it appears.")}</p>
        {selectedAnnotation&&<><span>{annotationLabel(selectedAnnotation.mark)}</span>{(["start","end"] as const).map(edge=><label key={edge}>{t(edge==="start"?"Effect start":"Effect end")}<VideoTimeInput value={selectedAnnotation[edge]} min={edge==="start"?0:selectedAnnotation.start+.05} max={edge==="start"?selectedAnnotation.end-.05:duration} step={.1} disabled={busy} onCommit={value=>{
          commitAnnotation.current?.();
          const current=docRef.current,selected=current.annotations.find(item=>item.id===selectedAnnotation.id);if(!selected)return;
          const next={...selected,[edge]:value};if(!Number.isFinite(value)||next.start<0||next.end>duration||next.end-next.start<.05-1e-9)return;apply({...current,annotations:current.annotations.map(item=>item.id===next.id?next:item)});setAnnotationRevision(v=>v+1);
        }}/></label>)}<button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();apply({...docRef.current,annotations:docRef.current.annotations.filter(item=>item.id!==selectedAnnotation.id)});setAnnotationId(null);setAnnotationRevision(v=>v+1);}}><Trash2 size={14}/>{t("Delete annotation")}</button></>}
        </section>:<VideoEffectsControls effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={id=>{video.current?.pause();previewing.current=false;setEffectId(id);}} time={time} duration={duration} disabled={busy} onSeek={seek} />}</aside>}
    </div>
    {!editing&&<VideoPlaybackControls video={video}/>}
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
          <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();apply({segments:[{start:0,end:duration}],effects:[],annotations:[]});setAnnotationRevision(v=>v+1);setSelected(0);setEffectId(null);seek(0);}} title={t("Reset edit")} aria-label={t("Reset edit")}><RotateCcw size={14}/></button>
        </div>
      </div>
      <div className="kiri-video-lanes">
      <div className="kiri-video-ruler">
        {Array.from({length:6},(_,i)=><span key={i}>{videoTimeLabel(duration*i/5)}</span>)}
        <input type="range" min={0} max={duration} step="any" value={time} disabled={busy} aria-label={t("Playhead")} aria-valuetext={videoTimeLabel(time)} onChange={e=>seek(Number(e.target.value))}/>
      </div>
      <div ref={track} className="kiri-video-track" onClick={event=>{
        if(busy||!track.current)return;const rect=track.current.getBoundingClientRect();seek((event.clientX-rect.left)/rect.width*duration);
      }}>
        <span className="kiri-video-lane-label">{t("Video")}</span>
        <div className="kiri-video-filmstrip" aria-hidden="true">{Array.from({length:12},(_,index)=><div key={index}>{frames[index]&&<img src={frames[index]} draggable={false} alt=""/>}</div>)}</div>
        {deletedRanges(segments,duration).map((gap,i)=><div key={`gap-${i}`} className="kiri-video-removed" style={{left:`${gap.start/duration*100}%`,width:`${(gap.end-gap.start)/duration*100}%`}}/>)}
        {segments.map((clip,index)=><div key={index} className="kiri-video-clip" data-selected={index===selected} style={{left:`${clip.start/duration*100}%`,width:`${(clip.end-clip.start)/duration*100}%`}}>
          <button type="button" className="kiri-video-clip-select" disabled={busy} aria-pressed={index===selected} aria-label={fmt("Segment %d: %@ to %@",index+1,videoTimeLabel(clip.start),videoTimeLabel(clip.end))} onClick={event=>{
            event.stopPropagation();commitAnnotation.current?.();setSelected(index);setEffectId(null);setAnnotating(false);const rect=track.current!.getBoundingClientRect();seek(event.detail===0?clip.start:Math.min(clip.end,Math.max(clip.start,(event.clientX-rect.left)/rect.width*duration)));
          }}><span>{String(index+1).padStart(2,"0")}</span></button>
          {(["start","end"] as const).map(edge=><div key={edge} className={`kiri-video-trim-handle kiri-video-trim-handle--${edge}`} role="slider" tabIndex={busy?-1:0} aria-label={fmt(edge==="start"?"Segment %d start":"Segment %d end",index+1)} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={clip[edge]} aria-valuetext={videoTimeLabel(clip[edge])} onPointerDown={event=>dragHandle(event,index,edge)} onClick={event=>event.stopPropagation()} onKeyDown={event=>{
            if(busy||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const next=trimSegment(segments,index,edge,clip[edge]+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1),duration);apply({...docRef.current,segments:next});seek(next[index][edge]);
          }}/>) }
        </div>)}
        <div className="kiri-video-playhead" style={{left:`${duration?time/duration*100:0}%`}}><span/></div>
      </div>
      <VideoEffectTracks effects={timelineItems} labels={trackLabels} duration={duration} selectedId={annotating?annotationId:effectId} disabled={busy} onSelect={selectTrack} onSeek={seek} onChange={changeTracks}/>
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
