import {useEffect,useRef,useState} from "react";
import {ArrowUpRight,ChevronDown,X} from "lucide-react";
import {t} from "../i18n";
import {VideoExportSettings} from "./VideoExportSettings";
import "./VideoExportPanel.css";

type Props={preset:"original"|"share"|"small";onPreset(value:Props["preset"]):void;sourceSize:{width:number;height:number};duration:number;valid:boolean;busy:boolean;error:boolean;saved:boolean;onSave():void;onOpen():void};
export function VideoExportPanel(props:Props){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    panel.current?.focus();
    const outside=(event:globalThis.PointerEvent)=>{const target=event.target as HTMLElement;if(!root.current?.contains(target)&&!target.closest(".kiri-choice-menu"))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!document.querySelector(".kiri-choice-menu")){event.preventDefault();event.stopImmediatePropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener("pointerdown",outside,true);window.addEventListener("keydown",key,true);
    return()=>{document.removeEventListener("pointerdown",outside,true);window.removeEventListener("keydown",key,true);};
  },[open]);
  return <div className="kiri-video-export" ref={root}>
    <button ref={trigger} type="button" className="kiri-button kiri-button--primary" aria-label={t("Export video")} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(value=>!value)}><ArrowUpRight size={15}/>{t(props.busy?"Exporting…":"Export")}<ChevronDown size={12}/></button>
    {open&&<div ref={panel} role="dialog" tabIndex={-1} aria-label={t("Export video")} className="kiri-video-export-panel">
      <div className="kiri-video-export-panel-title"><strong>{t("Export video")}</strong><button type="button" className="kiri-icon-button" aria-label={t("Close")} onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={14}/></button></div>
      <VideoExportSettings preset={props.preset} onChange={props.onPreset} sourceSize={props.sourceSize} outputDuration={props.duration} disabled={props.busy}/>
      <p>{t("Your original recording stays unchanged.")}</p>
      <div className="kiri-video-export-status" role={props.error?"alert":"status"}>{props.busy?t("Saving a new video to your library…"):props.error?t("Couldn't export the video. Check library access and free disk space, then retry."):props.saved?t("Copy saved to library"):null}</div>
      <div className="kiri-video-export-panel-actions">{props.saved&&<button type="button" className="kiri-button kiri-button--secondary" onClick={props.onOpen}>{t("Open")}</button>}<button type="button" className="kiri-button kiri-button--primary" disabled={!props.valid||props.busy} onClick={props.onSave}>{t(props.busy?"Exporting…":"Save a Copy")}</button></div>
    </div>}
  </div>;
}
