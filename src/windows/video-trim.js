export const MIN_CLIP = 0.05;
export const MAX_CLIPS = 128;
export function validVideoRange(start, end, duration) {
  return [start, end, duration].every(Number.isFinite)
    && duration > 0 && start >= 0 && end > start && end <= duration;
}
export function validSegments(segments, duration) {
  return segments.length > 0 && segments.length <= MAX_CLIPS && segments.every((s, i) =>
    validVideoRange(s.start, s.end, duration) && (i === 0 || s.start >= segments[i - 1].end));
}
export function videoTimeLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}
export function splitSegment(segments, time) {
  if (!Number.isFinite(time) || segments.length >= MAX_CLIPS) return segments;
  const index = segments.findIndex(s => time >= s.start + MIN_CLIP && time <= s.end - MIN_CLIP);
  if (index < 0) return segments;
  const current = segments[index];
  return [...segments.slice(0,index), {start:current.start,end:time}, {start:time,end:current.end}, ...segments.slice(index+1)];
}
export function trimSegment(segments, index, edge, value, duration) {
  if (!Number.isFinite(value) || !segments[index]) return segments;
  const segment = segments[index];
  const minimum = Math.min(MIN_CLIP, segment.end - segment.start);
  const low = edge === 'start' ? (segments[index-1]?.end ?? 0) : segment.start + minimum;
  const high = edge === 'start' ? segment.end - minimum : (segments[index+1]?.start ?? duration);
  const next = Math.min(high,Math.max(low,value));
  return segments.map((s,i) => i === index ? {...s,[edge]:next} : s);
}
export function timelineDuration(segments) {
  return segments.reduce((sum,s)=>sum+s.end-s.start,0);
}
// A source-time playhead skips deleted gaps while previewing the finished edit.
export function nextPlayableTime(segments, time) {
  for (const s of segments) {
    if (time < s.start) return s.start;
    if (time < s.end - 0.001) return time;
  }
  return null;
}
export function outputTime(segments, sourceTime) {
  let total=0;
  for (const s of segments) {
    if (sourceTime < s.start) return total;
    total += Math.max(0,Math.min(sourceTime,s.end)-s.start);
    if (sourceTime < s.end) return total;
  }
  return total;
}
export function deletedRanges(segments,duration) {
  const gaps=[]; let previous=0;
  for(const s of segments) { if(s.start>previous) gaps.push({start:previous,end:s.start}); previous=s.end; }
  if(previous<duration) gaps.push({start:previous,end:duration});
  return gaps;
}
