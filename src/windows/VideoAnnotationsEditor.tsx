import {useEffect, useRef, useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {VideoEffectSlider} from "./VideoEffectSlider";
import {ChoiceSelect} from "../components/ChoiceSelect";
import AnnotationCanvas, {type AnnotationCanvasHandle} from "../annotation/AnnotationCanvas";
import {COLOR_HEX,COLOR_LABELS,COLOR_PRESETS,type AnnotationMark,type Tool} from "../annotation/model";
import {KiriIcon,type IconName} from "../components/KiriIcons";
import {t} from "../i18n";
import "./VideoAnnotationsEditor.css";
import {useAnnotationAppearance} from "../annotation/useAnnotationAppearance";

export type VideoAnnotationsEditorProps={
  onLiveMarks?(marks:AnnotationMark[],draft:AnnotationMark|null,editingId:number|null):void;
  onFrame?(canvas:HTMLCanvasElement):void;active:boolean;onActivate():void;extraTools?:ReactNode;image:HTMLImageElement|null;sourceSize:{width:number;height:number};viewSize:{width:number;height:number};
  marks:AnnotationMark[];revision:number;toolbarHost?:HTMLElement|null;appearanceHost?:HTMLElement|null;selectedMarkId?:number|null;onSelectionChange?(markId:number|null):void;disabled:boolean;
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
  const canvas=useRef<AnnotationCanvasHandle>(null),adjustingFont=useRef(false);
  const [tool,setTool]=useState<Tool>("select");
  useEffect(()=>{
    props.onCommitReady?.(()=>{canvas.current?.endTextFontSizeAdjustment();canvas.current?.commitTextEditing();});
    return()=>props.onCommitReady?.(null);
  },[props.onCommitReady]);
  const [appearance,setAppearance]=useAnnotationAppearance();
  const scale=props.sourceSize.width/Math.max(1,props.viewSize.width);
  const scaled={...appearance,penWidth:appearance.penWidth*scale,shapeWidth:appearance.shapeWidth*scale,textFontSize:appearance.textFontSize*scale,mosaicBrushDiameter:appearance.mosaicBrushDiameter*scale};
  function selectTool(next:Tool) {canvas.current?.commitTextEditing();setTool(next);props.onActivate();}
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(props.disabled||event.defaultPrevented) return;
      if(event.target instanceof HTMLElement && event.target.closest("[role=listbox],[role=dialog]")) return;
      if(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      if(!props.active){const entry=tools.find(item=>item.key===event.key.toLowerCase());if(entry&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();selectTool(entry.tool);}return;}
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="z") {event.preventDefault();event.stopImmediatePropagation();event.shiftKey?canvas.current?.redo():canvas.current?.undo();return;}
      if(event.metaKey||event.ctrlKey||event.altKey) return;
      if(event.key==="Delete"||event.key==="Backspace") {event.preventDefault();canvas.current?.deleteSelection();return;}
      if(event.key==="Escape") {event.preventDefault();event.stopImmediatePropagation();canvas.current?.commitTextEditing();props.onClose();return;}
      const entry=tools.find(item=>item.key===event.key.toLowerCase());
      if(entry){event.preventDefault();event.stopImmediatePropagation();canvas.current?.commitTextEditing();selectTool(entry.tool);}
    };
    window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);
  },[props.disabled,props.active,props.onClose,props.onActivate]);
  const sizeKey=tool==="text"?"textFontSize":tool==="mosaic"?"mosaicBrushDiameter":tool==="pen"?"penWidth":"shapeWidth";
  const appearanceControls=props.active&&tool!=="select"&&<div className="kiri-video-annotation-appearance">
        <VideoEffectSlider label={t(tool==="text"?"Font":tool==="mosaic"||tool==="pen"?"Brush":"Line")} min={tool==="text"||tool==="mosaic"?12:1} max={tool==="text"?64:tool==="mosaic"?120:24} step={1} value={appearance[sizeKey]} text={String(appearance[sizeKey])} disabled={props.disabled} onChange={(value,transient)=>{
          if(tool==="text"&&!adjustingFont.current){canvas.current?.beginTextFontSizeAdjustment();adjustingFont.current=true;}
          setAppearance({...appearance,[sizeKey]:value});
          if(tool==="text")canvas.current?.setTextFontSizeLive(value*scale);
          if(!transient){canvas.current?.endTextFontSizeAdjustment();adjustingFont.current=false;}
        }}/>

        {tool==="text"&&<ChoiceSelect label={t("Text background")} disabled={props.disabled} value={appearance.textBackgroundStyle} onChange={textBackgroundStyle=>setAppearance({...appearance,textBackgroundStyle})} options={[{value:"transparent",label:t("Transparent"),description:t("No background")},{value:"dark",label:t("Dark"),description:t("Dark background")}]} />}
        {tool==="mosaic"?<><ChoiceSelect label={t("Mosaic")} disabled={props.disabled} value={appearance.mosaicStyle} onChange={mosaicStyle=>setAppearance({...appearance,mosaicStyle})} options={[{value:"pixel",label:t("Pixel"),description:t("Pixel mosaic")},{value:"blur",label:t("Blur"),description:t("Gaussian blur")}]} /><ChoiceSelect label={t("Intensity")} disabled={props.disabled} value={appearance.mosaicIntensity} onChange={mosaicIntensity=>setAppearance({...appearance,mosaicIntensity})} options={[{value:"soft",label:t("Soft")},{value:"standard",label:t("Standard")},{value:"strong",label:t("Strong")}]} /></>:COLOR_PRESETS.map(color=><button type="button" className="kiri-video-annotation-swatch" key={color} style={{background:COLOR_HEX[color]}} title={t(COLOR_LABELS[color])} aria-label={t(COLOR_LABELS[color])} aria-pressed={appearance.colorPreset===color} onClick={()=>setAppearance({...appearance,colorPreset:color})}/>)}
      </div>;
  const toolbar=<fieldset disabled={props.disabled} className={`kiri-video-annotation-tools${props.toolbarHost?" kiri-video-annotation-tools--hosted":""}`} aria-label={t("Annotations")}>
      {tools.map(item=><button type="button" key={item.tool} className="kiri-video-annotation-tool" title={t(item.label)} aria-label={t(item.label)} aria-pressed={props.active&&tool===item.tool} onClick={()=>selectTool(item.tool)}><KiriIcon name={item.icon} size={17}/></button>)}
      {props.extraTools}
      {!props.appearanceHost&&appearanceControls}
    </fieldset>;
  return <div className="kiri-video-annotations-editor">
    {props.toolbarHost?createPortal(toolbar,props.toolbarHost):toolbar}
    {props.appearanceHost&&createPortal(appearanceControls,props.appearanceHost)}
    {props.active&&<div className="kiri-video-annotation-surface" style={{width:props.viewSize.width,height:props.viewSize.height}}>
      <AnnotationCanvas ref={canvas} onLiveMarks={props.onLiveMarks} onFrame={props.onFrame} image={props.image} region={{x:0,y:0,...props.sourceSize}} viewSize={props.viewSize}
        initialDocument={{schemaVersion:1,canvas:props.sourceSize,sourcePixels:props.sourceSize,marks:props.marks}} documentRevision={props.revision} selectedMarkId={props.selectedMarkId} onSelectionChange={props.onSelectionChange}
        interactionDisabled={props.disabled} tool={tool} appearance={scaled} onHistoryChange={noop} onDocumentChange={props.onChange} onUndo={props.onUndo} onRedo={props.onRedo} onCancel={props.onClose}/>
    </div>}
  </div>;
}
