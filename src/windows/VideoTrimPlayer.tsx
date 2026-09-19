import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause, RotateCcw, X, ImagePlus } from "lucide-react";
import { api } from "../lib/ipc";
import { fmt, t } from "../i18n";
import { segmentSpeed, timelineSegments, projectTimedRange, sourceAtOutput, moveSegment, outputTime, splitSegment, timelineDuration, trimSegment, validSegments, videoTimeLabel, type VideoSegment } from "./video-trim.js";
import { useVideoThumbnails } from "./useVideoThumbnails";
import { VideoEffectsControls, VideoEffectsOverlay } from "./VideoEffects";
import {defaultOverlayRange, videoZoomViewport, type VideoEffect} from "./video-effects";
import {paintVideoMasks} from "./video-effect-render";
import "./video-trim.css";
import {VideoOutputEffectTracks} from "./VideoOutputEffectTracks";
import {ChoiceSelect} from "../components/ChoiceSelect";
import {VideoPlaybackControls} from "./VideoPlaybackControls";
import {VideoTimeInput} from "./VideoTimeInput";
import {VideoExportSettings} from "./VideoExportSettings";

import {importVideoSticker,rasterizeVideoStickers,type VideoSticker} from "./video-stickers";
import type {AnnotationMark} from "../annotation/model";
import {VideoAnnotationsEditor} from "./VideoAnnotationsEditor";
import {renderVideoAnnotations,rasterizeVideoAnnotations} from "./video-annotation-render";
type VideoAnnotationTrack = {id:string;start:number;end:number;mark:AnnotationMark};
type EditDocument = { segments: VideoSegment[]; effects: VideoEffect[]; annotations:VideoAnnotationTrack[];stickers:VideoSticker[] };
const annotationLabel=(mark:AnnotationMark)=>t(({pen:"Pen",rectangle:"Rectangle",line:"Line",arrow:"Arrow",text:"Text",mosaic:"Mosaic"} as const)[mark.kind]);
const unchanged = (a: EditDocument, b: EditDocument) => JSON.stringify(a) === JSON.stringify(b);

export function VideoTrimPlayer(props: { id: string; src: string; editable: boolean; onClose(): void; onError(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const container=useRef<HTMLDivElement>(null);
  const playbackIndex=useRef(0);
  const [timelineHeight,setTimelineHeight]=useState(210);
  const [draggedClip,setDraggedClip]=useState<number|null>(null);
  const [dropIndex,setDropIndex]=useState<number|null>(null);
  const [dragOffset,setDragOffset]=useState(0);
  const suppressClick=useRef(false);
  const isWindows=/Windows/i.test(navigator.userAgent);
  const canvas = useRef<HTMLCanvasElement>(null);
  const maskPreviewFrame=useRef<HTMLCanvasElement|null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const stickerInput=useRef<HTMLInputElement>(null);
  const stickerImages=useRef(new Map<string,HTMLImageElement>());
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [importing,setImporting]=useState(false);
  const [stickerError,setStickerError]=useState(false);
  const commitAnnotation = useRef<(() => void) | null>(null);
  const registerAnnotationCommit = useCallback((commit:(()=>void)|null)=>{commitAnnotation.current=commit;},[]);
  const previewing = useRef(false);
  const previewStop = useRef<number|null>(null);
  const dragBase = useRef<EditDocument | null>(null);
  const history = useRef<{ past: EditDocument[]; future: EditDocument[] }>({past:[],future:[]});
  const [doc, setDoc] = useState<EditDocument>({segments:[],effects:[],annotations:[],stickers:[]});
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
  const {segments,effects,annotations,stickers} = doc;
  const selectedSticker=stickers.find(item=>item.id===effectId);
  const selectedAnnotation=annotations.find(item=>item.id===annotationId);
  const visibleAnnotations=annotations.filter(item=>(time>=item.start&&time<item.end)||item.id===annotationId);
  const timelineItems=[...effects,...stickers.map(item=>({...item,kind:"mask" as const})),...annotations.map(item=>({id:item.id,kind:"mask" as const,start:item.start,end:item.end,x:0,y:0,width:1,height:1}))];
  const trackLabels=Object.fromEntries([...annotations.map(item=>[item.id,annotationLabel(item.mark)]),...stickers.map((item,index)=>[item.id,`${t("Sticker")} ${index+1}`])]);
  const selectedClip=segments[selected];
  const total=timelineDuration(segments);
  const timeline=timelineSegments(segments);
  const clockTime=outputTime(segments,time,playbackIndex.current);
  const valid=validSegments(segments,duration);
  const canSplit=splitSegment(segments,time)!==segments;

  const seek = useCallback((value:number) => {
    const player=video.current;
    if(!player || !Number.isFinite(value)) return;
    commitAnnotation.current?.();
    previewing.current=false;previewStop.current=null; player.pause();
    const next=Math.max(0,Math.min(duration,value));
    const index=docRef.current.segments.findIndex(segment=>next>=segment.start&&next<segment.end);
    if(index>=0)playbackIndex.current=index;
    player.currentTime=next; setTime(next);
  },[duration]);

  function seekOutput(value:number){const target=sourceAtOutput(docRef.current.segments,value);if(!target)return;seek(target.time);playbackIndex.current=target.index;setSelected(target.index);}

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
    setSavedId(null); setError(false); previewing.current=false;previewStop.current=null; video.current?.pause();
  }
  function undo(redo=false) {
    if(busy || dragBase.current) return;
    commitAnnotation.current?.();
    const from=redo ? history.current.future : history.current.past;
    const next=from.pop(); if(!next) return;
    (redo ? history.current.past : history.current.future).push(docRef.current);
    docRef.current=next; setDoc(next); setEffectId(null);setAnnotationRevision(value=>value+1);
    setSelected(index=>Math.min(index,Math.max(0,next.segments.length-1)));
    setSavedId(null); setError(false); previewing.current=false;previewStop.current=null; video.current?.pause();
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
    const target=next[Math.min(selected,next.length-1)];if(target)seek(target.start);
  }
  function setClipRate(player:HTMLVideoElement,segment:VideoSegment){player.playbackRate=segmentSpeed(segment);player.preservesPitch=!isWindows;}
  function playEdit(){
    const player=video.current;if(!player||!valid||busy)return;
    previewStop.current=null;
    if(!player.paused){previewing.current=false;player.pause();return;}
    commitAnnotation.current?.();setEffectId(null);setAnnotating(false);
    const clips=docRef.current.segments;
    let index=clips.findIndex((clip,i)=>i===playbackIndex.current&&player.currentTime>=clip.start&&player.currentTime<clip.end-.001);
    if(index<0)index=clips.findIndex(clip=>player.currentTime>=clip.start&&player.currentTime<clip.end-.001);
    if(index<0){index=playbackIndex.current>=clips.length-1?0:Math.max(0,playbackIndex.current);player.currentTime=clips[index].start;}
    playbackIndex.current=index;setSelected(index);setClipRate(player,clips[index]);previewing.current=true;
    void player.play().catch(()=>{previewing.current=false;});
  }
  function previewEffect(id:string){
    commitAnnotation.current?.();const current=docRef.current,effect=current.effects.find(item=>item.id===id),player=video.current;
    if(!effect||!player||busy)return;
    const range=projectTimedRange(current.segments,effect.start,effect.end)[0];
    if(!range){setEffectId(id);return;}
    setEffectId(null);setAnnotating(false);
    const from=Math.max(range.clipStart,range.start-.15),until=Math.min(range.clipEnd,range.end+.15),target=sourceAtOutput(current.segments,from);if(!target)return;
    playbackIndex.current=target.index;setSelected(target.index);setClipRate(player,current.segments[target.index]);player.currentTime=target.time;
    previewStop.current=until;previewing.current=true;
    void player.play().catch(()=>{previewing.current=false;previewStop.current=null;});
  }
  function updatePlayback(){
    const player=video.current;if(!player)return;
    if(previewStop.current!==null&&outputTime(docRef.current.segments,player.currentTime,playbackIndex.current)>=previewStop.current){player.pause();previewing.current=false;previewStop.current=null;}
    if(previewing.current&&!player.seeking){
      const clips=docRef.current.segments,current=clips[playbackIndex.current];
      if(current&&player.currentTime>=current.end-.001){
        const next=clips[playbackIndex.current+1];
        if(next){playbackIndex.current++;setSelected(playbackIndex.current);setClipRate(player,next);player.currentTime=next.start;if(player.paused)void player.play().catch(()=>{previewing.current=false;});}
        else{previewing.current=false;player.pause();player.currentTime=current.end;}
      }
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
    if(!editing || annotating || !player || !output) return;
    const buffer=document.createElement("canvas");
    const scale=Math.min(1,1280/Math.max(sourceSize.width,sourceSize.height));
    buffer.width=output.width=Math.max(1,Math.round(sourceSize.width*scale));
    buffer.height=output.height=Math.max(1,Math.round(sourceSize.height*scale));
    const maskScratch=document.createElement("canvas");
    const sourceFrame=document.createElement("canvas");sourceFrame.width=sourceSize.width;sourceFrame.height=sourceSize.height;
    const frameCtx=sourceFrame.getContext("2d");
    const sourceCtx=buffer.getContext("2d"),ctx=output.getContext("2d");
    if(!sourceCtx || !ctx || !frameCtx) return;
    let frame=0;
    const draw=()=>{
      cancelAnimationFrame(frame);
      const clip=docRef.current.segments[playbackIndex.current];
      const inDeletedGap=previewing.current&&(!clip||player.currentTime<clip.start||player.currentTime>=clip.end);
      if(player.readyState>=2 && !player.seeking && !inDeletedGap) {
        const active=effects.filter(e=>player.currentTime>=e.start && player.currentTime<e.end);
        frameCtx.drawImage(player,0,0,sourceSize.width,sourceSize.height);

        sourceCtx.save();sourceCtx.scale(buffer.width/sourceSize.width,buffer.height/sourceSize.height);
        renderVideoAnnotations(sourceCtx,sourceFrame,annotations.filter(item=>player.currentTime>=item.start&&player.currentTime<item.end).map(item=>item.mark),sourceSize);
        for(const sticker of stickers){if((player.currentTime>=sticker.start&&player.currentTime<sticker.end)||sticker.id===effectId){const image=stickerImages.current.get(sticker.id);if(image)sourceCtx.drawImage(image,sticker.x*sourceSize.width,sticker.y*sourceSize.height,sticker.width*sourceSize.width,sticker.height*sourceSize.height);}}
        sourceCtx.restore();
        const masks=[...active];
        const selectedEffect=effects.find(item=>item.id===effectId);
        if(selectedEffect?.kind==="mask"&&!masks.includes(selectedEffect))masks.push(selectedEffect);
        if(selectedEffect?.kind==="mask"){const preview=maskPreviewFrame.current??(maskPreviewFrame.current=document.createElement("canvas"));preview.width=buffer.width;preview.height=buffer.height;preview.getContext("2d")?.drawImage(buffer,0,0);}
        paintVideoMasks(sourceCtx,masks,maskScratch);
        const zoom=effectId?null:active.find(e=>e.kind==="zoom");
        const viewport=zoom?videoZoomViewport(zoom,player.currentTime):null;
        ctx.clearRect(0,0,output.width,output.height);
        if(viewport) ctx.drawImage(buffer,viewport.x*buffer.width,viewport.y*buffer.height,viewport.width*buffer.width,viewport.height*buffer.height,0,0,output.width,output.height);
        else ctx.drawImage(buffer,0,0);
      }
      if(!player.paused) frame=requestAnimationFrame(draw);
    };
    const events=["seeked","loadeddata","play","pause"];
    events.forEach(event=>player.addEventListener(event,draw)); draw();
    return()=>{cancelAnimationFrame(frame);events.forEach(event=>player.removeEventListener(event,draw));};
  },[editing,effectId,annotating,effects,annotations,stickers,sourceSize]);

  useEffect(()=>{
    if(!editing||annotating) return;
    const onKey=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement;
      if(target.closest("input,select,textarea,[contenteditable=true],[role=listbox]")) return;
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
    const target=event.currentTarget,rect=track.current.getBoundingClientRect(),origin=event.clientX;
    commitAnnotation.current?.();
    const baseline=docRef.current;
    setSelected(index);setEffectId(null);setAnnotating(false);dragBase.current=baseline;
    target.setPointerCapture(event.pointerId);
    const move=(e:globalThis.PointerEvent)=>{
      const value=baseline.segments[index][edge]+(e.clientX-origin)/rect.width*timelineDuration(baseline.segments)*segmentSpeed(baseline.segments[index]);
      const next=trimSegment(baseline.segments,index,edge,value,duration);
      apply({...baseline,segments:next},true);seek(next[index][edge]);playbackIndex.current=index;
    };
    const finish=(e:globalThis.PointerEvent)=>{
      target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",key,true);
      if(target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      apply(docRef.current);
    };
    const cancel=(e:globalThis.PointerEvent)=>{docRef.current=baseline;finish(e);setDoc(baseline);};
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel(new globalThis.PointerEvent("pointercancel",{pointerId:event.pointerId}));}};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);window.addEventListener("keydown",key,true);
  }

  function reorderClip(from:number,to:number){
    commitAnnotation.current?.();const current=docRef.current,next=moveSegment(current.segments,from,to);if(next===current.segments)return;
    apply({...current,segments:next});setSelected(to);playbackIndex.current=to;setEffectId(null);setAnnotating(false);seek(next[to].start);
  }
  function dragClip(event:PointerEvent<HTMLButtonElement>,index:number){
    if(busy||event.button!==0||!track.current)return;
    event.stopPropagation();commitAnnotation.current?.();video.current?.pause();previewing.current=false;
    const target=event.currentTarget,rect=track.current.getBoundingClientRect(),origin=event.clientX;
    const entries=timelineSegments(docRef.current.segments),length=entries.length,extent=timelineDuration(docRef.current.segments);
    let moved=false,slot=index;
    setSelected(index);target.setPointerCapture(event.pointerId);
    const move=(e:globalThis.PointerEvent)=>{
      if(!moved&&Math.abs(e.clientX-origin)<5)return;
      moved=true;setDraggedClip(index);setDragOffset(e.clientX-origin);
      const point=(e.clientX-rect.left)/rect.width*extent;
      slot=entries.findIndex(entry=>point<(entry.start+entry.end)/2);if(slot<0)slot=length;
      setDropIndex(slot);
    };
    const cleanup=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",cancel);window.removeEventListener("keydown",key,true);setDraggedClip(null);setDropIndex(null);setDragOffset(0);};
    const finish=()=>{cleanup();if(moved){suppressClick.current=true;reorderClip(index,Math.max(0,Math.min(length-1,slot>index?slot-1:slot)));}};
    const cancel=()=>{cleanup();suppressClick.current=moved;};
    const key=(e:globalThis.KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",cancel);window.addEventListener("keydown",key,true);
  }
  function resizeTimeline(event:PointerEvent<HTMLDivElement>){
    if(event.button!==0)return;event.preventDefault();const target=event.currentTarget,origin=event.clientY,initial=timelineHeight;target.setPointerCapture(event.pointerId);
    const move=(e:globalThis.PointerEvent)=>{const maximum=Math.min(400,(container.current?.clientHeight??700)*.5);setTimelineHeight(Math.max(160,Math.min(maximum,initial+origin-e.clientY)));};
    const finish=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",finish);};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish);target.addEventListener("pointercancel",finish);
  }

  async function addSticker(file:File){
    if(importing||busy)return;setImporting(true);setStickerError(false);commitAnnotation.current?.();
    try{
      const {dataUrl,image}=await importVideoSticker(file);if(!alive.current)return;
      const current=docRef.current;
      if([...stickerImages.current.values()].reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight*4,0)+image.naturalWidth*image.naturalHeight*4>128*1024*1024)throw Error("Sticker memory limit");
      if(current.annotations.length+current.stickers.length>=128||current.stickers.reduce((sum,item)=>sum+item.dataUrl.length,0)+dataUrl.length>32*1024*1024)throw Error("Sticker limit");
      const ratio=image.naturalWidth/image.naturalHeight,sourceRatio=sourceSize.width/sourceSize.height;
      const width=Math.min(.3,.3*ratio/sourceRatio),height=width*sourceRatio/ratio;
      const {start,end}=defaultOverlayRange(video.current?.currentTime??time,duration);
      const item:VideoSticker={id:`sticker-${crypto.randomUUID()}`,start,end,x:(1-width)/2,y:(1-height)/2,width,height,dataUrl};
      stickerImages.current.set(item.id,image);apply({...current,stickers:[...current.stickers,item]});setAnnotating(false);setAnnotationId(null);setEffectId(item.id);seek(start);
    }catch{if(alive.current)setStickerError(true);}finally{if(alive.current)setImporting(false);}
  }

  async function saveCopy() {
    if(saving.current||!valid) return;
    commitAnnotation.current?.();
    const snapshot=docRef.current;
    saving.current=true;setBusy(true);setError(false);setSavedId(null);setAnnotating(false);
    previewing.current=false;video.current?.pause();setEffectId(null);
    try {await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));const rasterized=[...rasterizeVideoAnnotations(snapshot.annotations,sourceSize),...rasterizeVideoStickers(snapshot.stickers)];setSavedId(await api.exportVideoCopy(props.id,snapshot.segments,snapshot.effects,rasterized,preset));}
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
  },[annotating,time,sourceSize,stickers,effectId]);
  function changeAnnotationMarks(marks:AnnotationMark[]){
    const current=docRef.current;
    const visibleIds=new Set(visibleAnnotations.map(item=>item.mark.id));
    const incoming=new Map(marks.map(mark=>[mark.id,mark]));
    const retained=current.annotations.flatMap(item=>{
      if(!visibleIds.has(item.mark.id))return [item];
      const mark=incoming.get(item.mark.id);return mark?[{...item,mark}]:[];
    });
    const existing=new Set(current.annotations.map(item=>item.mark.id));
    const {start,end}=defaultOverlayRange(time,duration);
    const added=marks.filter(mark=>!existing.has(mark.id)).map(mark=>({id:`annotation-${mark.id}`,mark,start,end}));
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
    apply({...docRef.current,effects:next.filter(item=>!item.id.startsWith("annotation-")&&!item.id.startsWith("sticker-")),stickers:docRef.current.stickers.map(item=>{const timing=byId.get(item.id);return timing?{...item,start:timing.start,end:timing.end}:item;}),annotations:docRef.current.annotations.map(item=>{
      const timing=byId.get(item.id);return timing?{...item,start:timing.start,end:timing.end}:item;
    })},transient);
  }

  return <div ref={container} className={`kiri-video-player ${editing ? "kiri-video-player--editing" : ""}`}>
    <header className="kiri-video-editor-heading">
      <div><strong>{t(editing ? "Video editor" : "Video")}</strong><span>{t(editing ? "Your original recording stays unchanged." : "Esc to close")}</span></div>
      <div className="kiri-video-header-actions">


        {editing ? <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();previewing.current=false;video.current?.pause();setEditing(false);setAnnotating(false);}}>{t("Close editor")}</button>
          : props.editable && <button type="button" className="kiri-button kiri-button--primary" disabled={duration<=0} onClick={()=>{video.current?.pause();setEditing(true);}}><Scissors size={14}/>{t("Trim & Export")}</button>}
        <button type="button" className="kiri-icon-button" aria-label={t("Close · Esc")} title={t("Close · Esc")} onClick={props.onClose}><X size={16}/></button>
      </div>
    </header>
    {stickerError&&<p role="alert" className="kiri-video-sticker-error">{t("Choose a PNG, JPEG or WebP image up to 10 MB and 16 megapixels.")}</p>}
    {editing&&<div ref={setAnnotationToolbar} className="kiri-video-annotation-toolbar-host"/>}
    <div className="kiri-video-workspace">
      <div ref={stage} className="kiri-video-stage">
        <div className="kiri-video-surface" style={{width:fitted.width,height:fitted.height}}>
          <video ref={video} src={props.src} crossOrigin="anonymous" controls={false} playsInline autoPlay preload="metadata"
            style={{visibility:editing?"hidden":"visible"}}
            onLoadedMetadata={event=>{
              const player=event.currentTarget,value=player.duration;
              const d=Number.isFinite(value)?value:0;setDuration(d);
              setSourceSize({width:player.videoWidth||16,height:player.videoHeight||9});
              const initial={segments:d>0?[{start:0,end:d}]:[],effects:[],annotations:[],stickers:[]};docRef.current=initial;setDoc(initial);
            }}
            onTimeUpdate={updatePlayback} onSeeked={updatePlayback}
            onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{updatePlayback();if(!previewing.current)setPlaying(false);}}
            onError={props.onError} />
          {editing && !annotating && <canvas ref={canvas} className="kiri-video-effect-preview" aria-label={t("Edited video preview")} />}
          {editing&&<div className="kiri-video-annotation-editor" style={{pointerEvents:annotating?"auto":"none"}}><VideoAnnotationsEditor active={annotating} onActivate={()=>{video.current?.pause();previewing.current=false;setEffectId(null);setAnnotating(true);}} extraTools={<><button type="button" className="kiri-video-annotation-tool" disabled={busy||importing||annotations.length+stickers.length>=128} title={t("Add image sticker")} aria-label={t("Add image sticker")} onClick={()=>stickerInput.current?.click()}><ImagePlus size={17}/></button><input ref={stickerInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void addSticker(file);}}/></>} onCommitReady={registerAnnotationCommit} toolbarHost={annotationToolbar} image={sourceImage} sourceSize={sourceSize} viewSize={fitted} marks={visibleAnnotations.map(item=>item.mark)} revision={annotationRevision} selectedMarkId={selectedAnnotation?.mark.id??null} onSelectionChange={markId=>setAnnotationId(markId===null?null:docRef.current.annotations.find(item=>item.mark.id===markId)?.id??null)} disabled={busy} onChange={changeAnnotationMarks} onUndo={()=>undo()} onRedo={()=>undo(true)} canUndo={!!history.current.past.length} canRedo={!!history.current.future.length} onClose={()=>{setAnnotating(false);setEffectId(null);setAnnotationId(null);}}/></div>}
          {editing&&annotating&&<div className="kiri-video-sticker-annotation-layer">{stickers.filter(item=>time>=item.start&&time<item.end).map(item=><img key={item.id} src={item.dataUrl} alt="" draggable={false} style={{position:"absolute",left:`${item.x*100}%`,top:`${item.y*100}%`,width:`${item.width*100}%`,height:`${item.height*100}%`}}/>)}</div>}
          {editing && effectId && !selectedSticker && <VideoEffectsOverlay effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={setEffectId} time={time} duration={duration} disabled={busy} />}
          {editing&&!annotating&&<VideoEffectsOverlay regionLabel={t("Sticker")} effects={stickers.map(item=>({...item,kind:"mask"}))} selectedId={effectId} onSelect={id=>{video.current?.pause();previewing.current=false;setEffectId(id);setAnnotationId(null);}} time={time} duration={duration} disabled={busy} onChange={(next,transient)=>{const rects=new Map(next.map(item=>[item.id,item]));apply({...docRef.current,stickers:docRef.current.stickers.map(item=>{const rect=rects.get(item.id);return rect?{...item,x:rect.x,y:rect.y,width:rect.width,height:rect.height}:item;})},transient);}}/>}
        </div>
        {editing && <span className="kiri-video-view-label">{t(effectId||annotating?"Position the effect on the original frame":"Edited preview")}</span>}
      </div>
      {editing && <aside className="kiri-video-inspector">{selectedSticker?<section className="kiri-video-annotation-inspector"><strong>{t("Sticker")}</strong><p>{t("Drag to move. Resize with the handles; set timing on its track.")}</p><button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{apply({...docRef.current,stickers:docRef.current.stickers.filter(item=>item.id!==selectedSticker.id)});setEffectId(null);}}><Trash2 size={14}/>{t("Delete sticker")}</button></section>:annotating?<section className="kiri-video-annotation-inspector"><strong>{t("Annotation timing")}</strong>
        <p>{t("Each annotation has its own track. Drag its edges to set when it appears.")}</p>
        {selectedAnnotation&&<><span>{annotationLabel(selectedAnnotation.mark)}</span>{(["start","end"] as const).map(edge=><label key={edge}>{t(edge==="start"?"Effect start":"Effect end")}<VideoTimeInput value={selectedAnnotation[edge]} min={edge==="start"?0:selectedAnnotation.start+.05} max={edge==="start"?selectedAnnotation.end-.05:duration} step={.1} disabled={busy} onCommit={value=>{
          commitAnnotation.current?.();
          const current=docRef.current,selected=current.annotations.find(item=>item.id===selectedAnnotation.id);if(!selected)return;
          const next={...selected,[edge]:value};if(!Number.isFinite(value)||next.start<0||next.end>duration||next.end-next.start<.05-1e-9)return;apply({...current,annotations:current.annotations.map(item=>item.id===next.id?next:item)});setAnnotationRevision(v=>v+1);
        }}/></label>)}<button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();apply({...docRef.current,annotations:docRef.current.annotations.filter(item=>item.id!==selectedAnnotation.id)});setAnnotationId(null);setAnnotationRevision(v=>v+1);}}><Trash2 size={14}/>{t("Delete annotation")}</button></>}
        </section>:<VideoEffectsControls frameSource={maskPreviewFrame} video={video.current} onPreview={previewEffect} effects={effects} onChange={(next,transient)=>apply({...docRef.current,effects:next},transient)} selectedId={effectId} onSelect={id=>{video.current?.pause();previewing.current=false;setEffectId(id);}} time={time} duration={duration} disabled={busy} onSeek={seek} />}</aside>}
    </div>
    {!editing&&<VideoPlaybackControls video={video}/>}
    {editing&&<><div className="kiri-video-timeline-divider" role="separator" aria-label={t("Timeline height")} aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={400} aria-valuenow={timelineHeight} tabIndex={0} onPointerDown={resizeTimeline} onKeyDown={event=>{if(["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();setTimelineHeight(value=>Math.max(160,Math.min(400,value+(event.key==="ArrowUp"?20:-20))));}}}/><section className="kiri-video-timeline" aria-label={t("Video timeline")} style={{height:timelineHeight}}>
      <div className="kiri-video-edit-tools">
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!valid||busy} onClick={playEdit} title={t("Play edited video · Space")}>{playing?<Pause size={14}/>:<Play size={14}/>} {t(playing?"Pause":"Preview edit")}</button>
        <span className="kiri-video-clock">{videoTimeLabel(clockTime)}<span> / {videoTimeLabel(total)}</span></span>
        <div className="kiri-video-tool-divider"/>
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!canSplit||busy} onClick={split} title={t("Split at playhead · S")}><Scissors size={14}/>{t("Split")}</button>
        <button type="button" className="kiri-button kiri-button--secondary" disabled={!selectedClip||busy} onClick={removeClip}><Trash2 size={14}/>{t("Delete segment")}</button>
        <div className="kiri-video-history">
          <button type="button" className="kiri-button kiri-button--secondary" disabled={!history.current.past.length||busy} onClick={()=>undo()} title={t("Undo")} aria-label={t("Undo")}><Undo2 size={14}/></button>
          <button type="button" className="kiri-button kiri-button--secondary" disabled={!history.current.future.length||busy} onClick={()=>undo(true)} title={t("Redo")} aria-label={t("Redo")}><Redo2 size={14}/></button>
          <button type="button" className="kiri-button kiri-button--secondary" disabled={busy} onClick={()=>{commitAnnotation.current?.();apply({segments:[{start:0,end:duration}],effects:[],annotations:[],stickers:[]});setAnnotationRevision(v=>v+1);setSelected(0);setEffectId(null);seek(0);}} title={t("Reset edit")} aria-label={t("Reset edit")}><RotateCcw size={14}/></button>
        </div>
      </div>
      <div className="kiri-video-lanes-scroll"><div className="kiri-video-lanes">
      <div className="kiri-video-ruler">
        {Array.from({length:6},(_,i)=><span key={i}>{videoTimeLabel(total*i/5)}</span>)}
        <input type="range" min={0} max={total} step="any" value={Math.min(total,clockTime)} disabled={busy||!total} aria-label={t("Playhead")} aria-valuetext={videoTimeLabel(clockTime)} onChange={event=>seekOutput(Number(event.target.value))}/>
      </div>
      <div ref={track} className="kiri-video-track" onClick={event=>{if(busy||!track.current)return;const rect=track.current.getBoundingClientRect();seekOutput((event.clientX-rect.left)/rect.width*total);}}>
        <span className="kiri-video-lane-label">{t("Video")}</span>
        {timeline.map(({segment:clip,index,start,end})=><div key={index} className="kiri-video-clip" data-selected={index===selected} data-dragging={index===draggedClip} style={{left:`${total?start/total*100:0}%`,width:`${total?(end-start)/total*100:0}%`,transform:index===draggedClip?`translateX(${dragOffset}px)`:undefined}}>
          <div className="kiri-video-filmstrip" aria-hidden="true">{Array.from({length:Math.max(1,Math.min(8,Math.ceil((end-start)/Math.max(total,.1)*12)))},(_,i)=>{const source=clip.start+(clip.end-clip.start)*i/Math.max(1,Math.ceil((end-start)/Math.max(total,.1)*12));const frame=frames[Math.min(frames.length-1,Math.floor(source/Math.max(duration,.1)*frames.length))];return <div key={i}>{frame&&<img src={frame} draggable={false} alt=""/>}</div>;})}</div>
          <button type="button" className="kiri-video-clip-select" disabled={busy} aria-pressed={index===selected} aria-label={fmt("Segment %d: %@ to %@",index+1,videoTimeLabel(clip.start),videoTimeLabel(clip.end))} title={t("Drag to reorder. Alt + arrow keys also moves the clip.")} onPointerDown={event=>dragClip(event,index)} onKeyDown={event=>{if(event.altKey&&["ArrowLeft","ArrowRight"].includes(event.key)){event.preventDefault();reorderClip(index,Math.max(0,Math.min(segments.length-1,index+(event.key==="ArrowLeft"?-1:1))));}}} onClick={event=>{event.stopPropagation();if(suppressClick.current){suppressClick.current=false;return;}commitAnnotation.current?.();setSelected(index);setEffectId(null);setAnnotating(false);const rect=track.current!.getBoundingClientRect();seekOutput(event.detail===0?start:Math.min(end,Math.max(start,(event.clientX-rect.left)/rect.width*total)));}}><span>{String(index+1).padStart(2,"0")}</span>{segmentSpeed(clip)!==1&&<span className="kiri-video-clip-rate">{segmentSpeed(clip)}×</span>}</button>
          {(["start","end"] as const).map(edge=><div key={edge} className={`kiri-video-trim-handle kiri-video-trim-handle--${edge}`} role="slider" tabIndex={busy?-1:0} aria-label={fmt(edge==="start"?"Segment %d start":"Segment %d end",index+1)} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={clip[edge]} aria-valuetext={videoTimeLabel(clip[edge])} onPointerDown={event=>dragHandle(event,index,edge)} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(busy||!["ArrowLeft","ArrowRight"].includes(event.key))return;event.preventDefault();const next=trimSegment(segments,index,edge,clip[edge]+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?1:.1),duration);apply({...docRef.current,segments:next});seek(next[index][edge]);playbackIndex.current=index;}}/>) }
        </div>)}
        {dropIndex!==null&&<div className="kiri-video-drop-marker" style={{left:`${total?(timeline[dropIndex]?.start??total)/total*100:0}%`}}/>}
        <div className="kiri-video-playhead" style={{left:`${total?Math.min(total,clockTime)/total*100:0}%`}}><span/></div>
      </div>
      <VideoOutputEffectTracks effects={timelineItems} labels={trackLabels} segments={segments} sourceDuration={duration} selectedId={annotating?annotationId:effectId} disabled={busy} onSelect={selectTrack} onSeek={seek} onChange={changeTracks}/>
      </div></div>
      <div className="kiri-video-timeline-detail">
        {thumbnailFailed&&<span>{t("Thumbnails unavailable; editing still works.")}</span>}
        {selectedClip&&<div className="kiri-video-clip-fields"><span>{fmt("Segment %d",selected+1)}</span><ChoiceSelect label={t("Clip speed")} value={String(segmentSpeed(selectedClip))} disabled={busy} onChange={value=>{commitAnnotation.current?.();apply({...docRef.current,segments:docRef.current.segments.map((clip,index)=>index===selected?{...clip,speed:Number(value)}:clip)});}} options={[.25,.5,.75,1,1.25,1.5,2,3,4].map(speed=>({value:String(speed),label:`${speed}×`,description:speed===1?t("Original speed"):undefined}))}/><span>{videoTimeLabel((selectedClip.end-selectedClip.start)/segmentSpeed(selectedClip))}</span>{(["start","end"] as const).map(edge=><label key={edge}>{t(edge==="start"?"Source in":"Source out")}<VideoTimeInput key={`${selected}-${edge}`}  min={0} max={duration} step={.1} disabled={busy} aria-label={t(edge==="start"?"Start time in seconds":"End time in seconds")} value={Number(selectedClip[edge].toFixed(3))} onCommit={value=>{const next=trimSegment(segments,selected,edge,value,duration);apply({...docRef.current,segments:next});seek(next[selected][edge]);playbackIndex.current=selected;}}/></label>)}</div>}
      </div>
      {isWindows&&selectedClip&&segmentSpeed(selectedClip)!==1&&<p className="kiri-video-pitch-note">{t("Changing clip speed also changes audio pitch on Windows.")}</p>}
    </section><footer className="kiri-video-export-footer">
        <div className="kiri-video-export-status" role={error?"alert":"status"}>{busy?t("Saving a new video to your library…"):error?t("Couldn't export the video. Check library access and free disk space, then retry."):savedId?<>{t("Copy saved to library")}<button type="button" className="kiri-button kiri-button--secondary" onClick={()=>void api.openAsset(savedId).catch(()=>setError(true))}>{t("Open")}</button></>:null}</div>
        <VideoExportSettings preset={preset} onChange={next=>{setPreset(next);setSavedId(null);}} sourceSize={sourceSize} outputDuration={total} disabled={busy}/>
        <button type="button" className="kiri-button kiri-button--primary" disabled={!valid||busy} onClick={()=>void saveCopy()}>{t(busy?"Exporting…":"Save a Copy")}</button>
      </footer></>}
  </div>;
}
