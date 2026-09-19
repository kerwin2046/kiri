import type {VideoEffect} from "./video-effects";

export type VideoLayer = {id:string;layer?:number;kind?:string;mark?:{kind:string};dataUrl?:string};
export const isVideoAdjustment = (item:VideoLayer) => item.kind === "zoom" || item.kind === "frame" || item.kind === "fade";

/** Old documents retain their composition; new layers carry an explicit order. */
export function videoLayerRank(item:VideoLayer):number {
  if(item.layer!==undefined)return item.layer;
  if(item.mark)return item.mark.kind==="mosaic"?0:1;
  if(item.dataUrl)return 2;
  return ({mask:3,spotlight:4,zoom:5,frame:6,fade:7} as Record<string,number>)[item.kind??""]??1;
}
export function nextVideoLayer(items:VideoLayer[]):number {
  return Math.max(-1,...items.map(videoLayerRank))+1;
}
export function orderedVideoLayers<T extends VideoLayer>(items:T[]):T[] {
  return [...items].sort((a,b)=>Number(isVideoAdjustment(a))-Number(isVideoAdjustment(b))||videoLayerRank(a)-videoLayerRank(b));
}
/** Timeline rows run front to back. Adjustments and overlays have separate stacks. */
export function moveVideoLayer<T extends VideoLayer>(items:T[],id:string,before:string|null):T[] {
  const moving=items.find(item=>item.id===id);if(!moving||before===id)return items;
  const group=orderedVideoLayers(items.filter(item=>isVideoAdjustment(item)===isVideoAdjustment(moving))).reverse();
  const rest=group.filter(item=>item.id!==id),index=before===null?rest.length:rest.findIndex(item=>item.id===before);
  if(index<0)return items;
  rest.splice(index,0,moving);
  if(rest.every((item,i)=>item.id===group[i].id))return items;
  const ranks=new Map(rest.map((item,i)=>[item.id,rest.length-i]));
  return items.map(item=>ranks.has(item.id)?{...item,layer:ranks.get(item.id)!}:item);
}

/** Bound trims instead of dropping pointer updates when an edge reaches a limit. */
export function retimeVideoLayer(effect:VideoEffect,mode:"move"|"start"|"end",delta:number,effects:VideoEffect[],duration:number):VideoEffect {
  let min=0,max=duration;
  if(isVideoAdjustment(effect)){
    for(const other of effects){
      if(other.id===effect.id||other.kind!==effect.kind)continue;
      if(other.end<=effect.start)min=Math.max(min,other.end);
      if(other.start>=effect.end)max=Math.min(max,other.start);
    }
  }
  if(mode==="move"){
    const shift=Math.max(min-effect.start,Math.min(max-effect.end,delta));
    return {...effect,start:effect.start+shift,end:effect.end+shift};
  }
  if(mode==="start")return {...effect,start:Math.max(min,Math.min(effect.end-.05,effect.start+delta))};
  return {...effect,end:Math.min(max,Math.max(effect.start+.05,effect.end+delta))};
}
