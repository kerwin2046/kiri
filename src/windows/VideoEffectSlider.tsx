import {useRef} from "react";

/** Explicit pointer mapping works in WKWebView as well as Chromium. */
export function VideoEffectSlider(props:{label:string;value:number;min:number;max:number;step:number;text:string;disabled?:boolean;onChange(value:number,transient:boolean):void}){
  const dragging=useRef(false),latest=useRef(props.value);
  function change(clientX:number,input:HTMLInputElement){
    const rect=input.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(clientX-rect.left-6)/Math.max(1,rect.width-12)));
    latest.current=Math.max(props.min,Math.min(props.max,props.min+Math.round(fraction*(props.max-props.min)/props.step)*props.step));
    props.onChange(latest.current,true);
  }
  function finish(){if(!dragging.current)return;dragging.current=false;props.onChange(latest.current,false);}
  return <label className="kiri-effect-slider"><span>{props.label}<output>{props.text}</output></span><input type="range" aria-label={props.label} className="kiri-range" value={props.value} min={props.min} max={props.max} step={props.step} disabled={props.disabled}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);change(event.clientX,event.currentTarget);}}
    onPointerMove={event=>{if(dragging.current)change(event.clientX,event.currentTarget);}}
    onChange={event=>{latest.current=Number(event.target.value);props.onChange(latest.current,dragging.current);}}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}/></label>;
}
