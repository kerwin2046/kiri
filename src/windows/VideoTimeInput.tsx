import {useEffect, useRef, useState} from "react";
import type {InputHTMLAttributes} from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onCommit(value: number): void;
};

// Keep partially typed numbers local; one committed edit creates one undo step.
export function VideoTimeInput({value, onCommit, ...props}: Props) {
  const format = (number: number) => String(Number(number.toFixed(3)));
  const [draft, setDraft] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => {if (!focused.current) setDraft(format(value));}, [value]);
  return <input {...props} type="number" value={draft}
    onFocus={() => {focused.current = true;}}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      focused.current = false;
      const number = draft.trim() ? Number(draft) : NaN;
      if (Number.isFinite(number) && number !== value) onCommit(number);
      setDraft(format(value));
    }}
    onKeyDown={event => {
      if (event.key === "Enter") {event.preventDefault(); event.currentTarget.blur();}
      if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); setDraft(format(value));}
    }}/>
}
