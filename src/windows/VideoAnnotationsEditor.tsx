import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import AnnotationCanvas, {type AnnotationCanvasHandle} from "../annotation/AnnotationCanvas";
import {COLOR_HEX,COLOR_LABELS,COLOR_PRESETS,DEFAULT_APPEARANCE,type AnnotationMark,type Tool,type AppearanceSettings} from "../annotation/model";
import {KiriIcon,type IconName} from "../components/KiriIcons";
import {t} from "../i18n";
import "./VideoAnnotationsEditor.css";

export type VideoAnnotationsEditorProps={
  image:HTMLImageElement|null;sourceSize:{width:number;height:number};viewSize:{width:number;height:number};
  marks:AnnotationMark[];revision:number;toolbarHost?:HTMLElement|null;selectedMarkId?:number|null;onSelectionChange?(markId:number|null):void;disabled:boolean;
  onCommitReady?(commit:(()=>void)|null):void;
  onChange(marks:AnnotationMark[]):void;onUndo():void;onRedo():void;canUndo:boolean;canRedo:boolean;onClose():void;
};
const tools:{tool:Tool;icon:IconName;label:string;key:string}[]=[
  {tool:"select",icon:"cursorarrow",label:"Select (V)",key:"v"},
  {tool:"pen",icon:"pencil.tip",label:"Pen (P)",key:"p"},
  {tool:"rectangle",icon:"rectangle.dashed",label:"Rectangle (R)",key:"r"},
  {tool:"line",icon:"line.diagonal",label:"Line (L)",key:"l"},
  {tool:"arrow",icon:"arrow.up.right",label:"Arrow (A)",key:"a"},
  {tool:"text",icon:"textformat",label:"Text (T)",key:"t"},
  {tool:"mosaic",icon:"square.grid.3x3.fill",label:"Mosaic (M)",key:"m"},
];
const noop=()=>{};
export function VideoAnnotationsEditor(props:VideoAnnotationsEditorProps) {
  const canvas=useRef<AnnotationCanvasHandle>(null);
  const [tool,setTool]=useState<Tool>("select");
  useEffect(()=>{
    props.onCommitReady?.(()=>{canvas.current?.endTextFontSizeAdjustment();canvas.current?.commitTextEditing();});
    return()=>props.onCommitReady?.(null);
  },[props.onCommitReady]);
  const [appearance,setAppearance]=useState<AppearanceSettings>({...DEFAULT_APPEARANCE,colorPreset:"white"});
  const scale=props.sourceSize.width/Math.max(1,props.viewSize.width);
  const scaled={...appearance,penWidth:appearance.penWidth*scale,shapeWidth:appearance.shapeWidth*scale,textFontSize:appearance.textFontSize*scale,mosaicBrushDiameter:appearance.mosaicBrushDiameter*scale};
  function selectTool(next:Tool) {canvas.current?.commitTextEditing();setTool(next);}
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(props.disabled||event.defaultPrevented) return;
      if(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="z") {event.preventDefault();event.stopImmediatePropagation();event.shiftKey?canvas.current?.redo():canvas.current?.undo();return;}
      if(event.metaKey||event.ctrlKey||event.altKey) return;
      if(event.key==="Delete"||event.key==="Backspace") {event.preventDefault();canvas.current?.deleteSelection();return;}
      if(event.key==="Escape") {event.preventDefault();event.stopImmediatePropagation();canvas.current?.commitTextEditing();props.onClose();return;}
      const entry=tools.find(item=>item.key===event.key.toLowerCase());
      if(entry){event.preventDefault();event.stopImmediatePropagation();canvas.current?.commitTextEditing();setTool(entry.tool);}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[props.disabled,props.onClose]);
  const sizeKey=tool==="text"?"textFontSize":tool==="mosaic"?"mosaicBrushDiameter":tool==="pen"?"penWidth":"shapeWidth";
  const toolbar=<fieldset disabled={props.disabled} className={`kiri-video-annotation-tools${props.toolbarHost?" kiri-video-annotation-tools--hosted":""}`} aria-label={t("Annotations")}>
      {tools.map(item=><button type="button" key={item.tool} className="kiri-video-annotation-tool" title={t(item.label)} aria-label={t(item.label)} aria-pressed={tool===item.tool} onClick={()=>selectTool(item.tool)}><KiriIcon name={item.icon} size={17}/></button>)}
      <span className="kiri-video-annotation-divider"/>
      <button type="button" className="kiri-video-annotation-tool" title={t("Undo (⌘Z)")} aria-label={t("Undo (⌘Z)")} disabled={!props.canUndo} onClick={()=>canvas.current?.undo()}><KiriIcon name="arrow.uturn.backward" size={17}/></button>
      <button type="button" className="kiri-video-annotation-tool" title={t("Redo (⇧⌘Z)")} aria-label={t("Redo (⇧⌘Z)")} disabled={!props.canRedo} onClick={()=>canvas.current?.redo()}><KiriIcon name="arrow.uturn.forward" size={17}/></button>
      <button type="button" className="kiri-button kiri-button--secondary" onClick={()=>{canvas.current?.commitTextEditing();props.onClose();}}>{t("Finish")}</button>
      {tool!=="select"&&<div className="kiri-video-annotation-appearance">
        <label>{t(tool==="text"?"Font":tool==="mosaic"||tool==="pen"?"Brush":"Line")}<input className="kiri-range" type="range" min={tool==="text"||tool==="mosaic"?12:1} max={tool==="text"?64:tool==="mosaic"?120:24} value={appearance[sizeKey]}
          onPointerDown={()=>{if(tool==="text")canvas.current?.beginTextFontSizeAdjustment();}}
          onPointerUp={()=>canvas.current?.endTextFontSizeAdjustment()} onPointerCancel={()=>canvas.current?.endTextFontSizeAdjustment()} onBlur={()=>canvas.current?.endTextFontSizeAdjustment()}
          onChange={event=>{const value=Number(event.target.value);setAppearance({...appearance,[sizeKey]:value});if(tool==="text")canvas.current?.setTextFontSizeLive(value*scale);}}/>{appearance[sizeKey]}</label>
        {tool==="text"&&<select aria-label={t("Text background")} value={appearance.textBackgroundStyle} onChange={event=>setAppearance({...appearance,textBackgroundStyle:event.target.value as AppearanceSettings["textBackgroundStyle"]})}><option value="transparent">{t("Transparent")}</option><option value="dark">{t("Dark")}</option></select>}
        {tool==="mosaic"?<><select aria-label={t("Mosaic")} value={appearance.mosaicStyle} onChange={event=>setAppearance({...appearance,mosaicStyle:event.target.value as AppearanceSettings["mosaicStyle"]})}><option value="pixel">{t("Pixel")}</option><option value="blur">{t("Blur")}</option></select><select aria-label={t("Intensity")} value={appearance.mosaicIntensity} onChange={event=>setAppearance({...appearance,mosaicIntensity:event.target.value as AppearanceSettings["mosaicIntensity"]})}><option value="soft">{t("Soft")}</option><option value="standard">{t("Standard")}</option><option value="strong">{t("Strong")}</option></select></>:COLOR_PRESETS.map(color=><button type="button" className="kiri-video-annotation-swatch" key={color} style={{background:COLOR_HEX[color]}} title={t(COLOR_LABELS[color])} aria-label={t(COLOR_LABELS[color])} aria-pressed={appearance.colorPreset===color} onClick={()=>setAppearance({...appearance,colorPreset:color})}/>)}
      </div>}
    </fieldset>;
  return <div className="kiri-video-annotations-editor">
    {props.toolbarHost?createPortal(toolbar,props.toolbarHost):toolbar}
    <div className="kiri-video-annotation-surface" style={{width:props.viewSize.width,height:props.viewSize.height}}>
      <AnnotationCanvas ref={canvas} image={props.image} region={{x:0,y:0,...props.sourceSize}} viewSize={props.viewSize}
        initialDocument={{schemaVersion:1,canvas:props.sourceSize,sourcePixels:props.sourceSize,marks:props.marks}} documentRevision={props.revision} selectedMarkId={props.selectedMarkId} onSelectionChange={props.onSelectionChange}
        interactionDisabled={props.disabled} tool={tool} appearance={scaled} onHistoryChange={noop} onDocumentChange={props.onChange} onUndo={props.onUndo} onRedo={props.onRedo} onCancel={props.onClose}/>
    </div>
  </div>;
}
