import {ChoiceSelect} from "../components/ChoiceSelect";
import {t,fmt} from "../i18n";
import {videoTimeLabel} from "./video-trim.js";
import "./VideoExportSettings.css";
type Preset="original"|"share"|"small";
export function VideoExportSettings(props:{preset:Preset;onChange(preset:Preset):void;sourceSize:{width:number;height:number};outputDuration:number;disabled?:boolean}){
  function size(preset:Preset){const limit=preset==="original"?Infinity:preset==="share"?1080:720;const ratio=Math.min(1,limit/Math.max(props.sourceSize.width,props.sourceSize.height));return ratio===1?props.sourceSize:{width:Math.max(2,Math.floor(props.sourceSize.width*ratio/2)*2),height:Math.max(2,Math.floor(props.sourceSize.height*ratio/2)*2)};}
  const dimensions=(preset:Preset)=>{const output=size(preset);return `${output.width} × ${output.height}`;};
  return <div className="kiri-video-export-settings"><div className="kiri-video-export-settings-title"><span>{t("Export quality")}</span><span>{videoTimeLabel(props.outputDuration)}</span></div>
    <ChoiceSelect value={props.preset} onChange={props.onChange} disabled={props.disabled} label={t("Export quality")} options={[
      {value:"original",label:t("High quality"),description:t("Keep source detail for demos and further editing."),trailing:dimensions("original")},
      {value:"share",label:t("Everyday sharing"),description:t("Longest edge up to 1080 px. A balanced file for sharing."),trailing:dimensions("share")},
      {value:"small",label:t("Compact file"),description:t("Longest edge up to 720 px. Easier to send and store."),trailing:dimensions("small")},
    ]}/><div className="kiri-video-export-settings-detail">MP4 · H.264 <span>{fmt("Output: %@ px",dimensions(props.preset))}</span></div>
  </div>;
}
