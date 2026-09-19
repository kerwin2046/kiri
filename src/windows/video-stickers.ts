import type {RasterizedVideoAnnotation} from "./video-annotation-render";
export type VideoSticker={id:string;start:number;end:number;x:number;y:number;width:number;height:number;dataUrl:string;layer?:number};
export async function importVideoSticker(file:File):Promise<{dataUrl:string;image:HTMLImageElement}>{
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>10*1024*1024)throw Error("Unsupported sticker");
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>16_777_216)throw Error("Sticker too large");
    const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext("2d");if(!ctx)throw Error("No canvas");ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL("image/png");const normalized=new Image();normalized.src=dataUrl;await normalized.decode();
    return{dataUrl,image:normalized};
  }finally{URL.revokeObjectURL(url);}
}
export function rasterizeVideoStickers(stickers:VideoSticker[]):RasterizedVideoAnnotation[]{
  return stickers.map(({start,end,x,y,width,height,dataUrl,layer})=>({start,end,x,y,width,height,kind:"overlay",imageBase64:dataUrl.split(",")[1],amount:0,layer}));
}
