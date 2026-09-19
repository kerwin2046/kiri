export const MIN_CLIP = 0.05;
export const MAX_CLIPS = 128;
export function segmentSpeed(segment) { return segment.speed ?? 1; }
export function validVideoRange(start, end, duration) {
  return [start, end, duration].every(Number.isFinite) && duration > 0 && start >= 0 && end > start && end <= duration;
}
export function validSegments(segments, duration) {
  if (!segments.length || segments.length > MAX_CLIPS || !segments.every(s => validVideoRange(s.start,s.end,duration) && Number.isFinite(segmentSpeed(s)) && segmentSpeed(s)>=.25 && segmentSpeed(s)<=4)) return false;
  const sorted=[...segments].sort((a,b)=>a.start-b.start);
  return sorted.every((s,i)=>i===0 || s.start>=sorted[i-1].end);
}
export function videoTimeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const tenths=Math.round(seconds*10);
  return `${Math.floor(tenths/600)}:${String(Math.floor(tenths/10)%60).padStart(2,"0")}.${tenths%10}`;
}
export function splitSegment(segments,time) {
  if (!Number.isFinite(time)||segments.length>=MAX_CLIPS)return segments;
  const index=segments.findIndex(s=>time>=s.start+MIN_CLIP && time<=s.end-MIN_CLIP);
  if(index<0)return segments;
  const current=segments[index];
  return [...segments.slice(0,index),{...current,end:time},{...current,start:time},...segments.slice(index+1)];
}
export function trimSegment(segments,index,edge,value,duration) {
  if(!Number.isFinite(value)||!segments[index])return segments;
  const segment=segments[index],minimum=Math.min(MIN_CLIP,segment.end-segment.start);
  const others=segments.filter((_,i)=>i!==index);
  const previousEnd=Math.max(0,...others.filter(s=>s.end<=segment.start).map(s=>s.end));
  const nextStart=Math.min(duration,...others.filter(s=>s.start>=segment.end).map(s=>s.start));
  const low=edge==='start'?previousEnd:segment.start+minimum;
  const high=edge==='start'?segment.end-minimum:nextStart;
  return segments.map((s,i)=>i===index?{...s,[edge]:Math.min(high,Math.max(low,value))}:s);
}
export function moveSegment(segments,from,to) {
  if(from===to||!segments[from]||to<0||to>=segments.length)return segments;
  const result=segments.slice(),[segment]=result.splice(from,1);result.splice(to,0,segment);return result;
}
export function timelineSegments(segments) {
  let offset=0;
  return segments.map((segment,index)=>{const start=offset;offset+=(segment.end-segment.start)/segmentSpeed(segment);return {segment,index,start,end:offset};});
}
export function timelineDuration(segments) {return segments.reduce((sum,s)=>sum+(s.end-s.start)/segmentSpeed(s),0);}
export function sourceAtOutput(segments,time) {
  const timeline=timelineSegments(segments);if(!timeline.length||!Number.isFinite(time))return null;
  const entry=timeline.find(s=>time<s.end)??timeline[timeline.length-1];
  return {index:entry.index,time:Math.min(entry.segment.end,entry.segment.start+Math.max(0,time-entry.start)*segmentSpeed(entry.segment))};
}
export function outputTime(segments,sourceTime,indexHint=-1) {
  const timeline=timelineSegments(segments);
  const entry=timeline.find(s=>s.index===indexHint&&sourceTime>=s.segment.start&&sourceTime<=s.segment.end)??timeline.find(s=>sourceTime>=s.segment.start&&sourceTime<s.segment.end);
  if(entry)return entry.start+Math.max(0,Math.min(sourceTime,entry.segment.end)-entry.segment.start)/segmentSpeed(entry.segment);
  const next=timeline.find(s=>s.segment.start>sourceTime);return next?.start??timelineDuration(segments);
}
// Used for source-based effect editing; ordered playback tracks its clip index explicitly.
export function nextPlayableTime(segments,time) {
  const inside=segments.find(s=>time>=s.start&&time<s.end-.001);if(inside)return time;
  return [...segments].sort((a,b)=>a.start-b.start).find(s=>s.start>time)?.start??null;
}
export function deletedRanges(segments,duration) {
  const gaps=[];let previous=0;
  for(const s of [...segments].sort((a,b)=>a.start-b.start)){if(s.start>previous)gaps.push({start:previous,end:s.start});previous=s.end;}
  if(previous<duration)gaps.push({start:previous,end:duration});return gaps;
}
export function projectTimedRange(segments,start,end) {
  return timelineSegments(segments).flatMap(entry=>{
    const sourceStart=Math.max(start,entry.segment.start),sourceEnd=Math.min(end,entry.segment.end);
    if(sourceEnd<=sourceStart)return [];
    const speed=segmentSpeed(entry.segment);
    return [{index:entry.index,start:entry.start+(sourceStart-entry.segment.start)/speed,end:entry.start+(sourceEnd-entry.segment.start)/speed,sourceStart,sourceEnd,speed,clipStart:entry.start,clipEnd:entry.end}];
  });
}
