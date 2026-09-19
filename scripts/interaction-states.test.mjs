import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {createLibraryHarness, nodes} from "./helpers/library-render-harness.mjs";

test("playback scrubbing updates without native range events and ends only once", () => {
  const source=readFileSync(new URL("../src/windows/VideoPlaybackControls.tsx",import.meta.url),"utf8");
  const slider=source.slice(source.indexOf("function PlaybackSlider("),source.indexOf("const RATE_KEY"));
  const harness=createLibraryHarness({},`import React,{useState,useRef} from "react"; const videoTimeLabel=String; ${slider}; export {PlaybackSlider};`);
  const changes=[];let starts=0,ends=0,captured=false;
  const component=harness.mount("PlaybackSlider",{value:0,max:10,label:"Seek",preview:true,onChange:value=>changes.push(value),onScrubStart:()=>starts++,onScrubEnd:()=>ends++});
  const input=nodes(component.render()).find(node=>node?.type==="input");
  const target={getBoundingClientRect:()=>({left:100,width:212}),focus(){},setPointerCapture(){captured=true;},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false;}};
  const event=x=>({button:0,pointerId:1,clientX:x,currentTarget:target,preventDefault(){}});
  input.props.onPointerDown(event(156));
  input.props.onPointerMove(event(256));
  input.props.onPointerMove(event(500));
  input.props.onPointerUp(event(500));
  input.props.onLostPointerCapture();
  assert.deepEqual(changes,[2.5,7.5,10]);
  assert.equal(starts,1);assert.equal(ends,1);assert.equal(captured,false);
  input.props.onChange({target:{value:"4"}});
  assert.equal(changes.at(-1),4);
  component.unmount();
});

test("effect slider drags form one undo transaction, including pointer capture loss",()=>{
  const source=readFileSync(new URL("../src/windows/VideoEffectSlider.tsx",import.meta.url),"utf8");
  const harness=createLibraryHarness({},source.replace('import {useRef}', 'import React,{useRef}'));
  const changes=[];
  const component=harness.mount("VideoEffectSlider",{label:"Strength",value:.5,min:0,max:1,step:.01,text:"50%",onChange:(value,transient)=>changes.push([value,transient])});
  const input=nodes(component.render()).find(node=>node?.type==="input");
  const target={getBoundingClientRect:()=>({left:100,width:212}),focus(){},setPointerCapture(){}};
  const event=x=>({button:0,pointerId:1,clientX:x,currentTarget:target,preventDefault(){}});
  input.props.onPointerDown(event(156));input.props.onPointerMove(event(256));input.props.onPointerUp();input.props.onLostPointerCapture();
  assert.deepEqual(changes,[[.25,true],[.75,true],[.75,false]]);
  input.props.onChange({target:{value:"0.5"}});assert.deepEqual(changes.at(-1),[.5,false]);
  component.unmount();
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repositoryRoot, "src");

function filesUnder(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(candidate, extensions);
    return entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))
      ? [candidate]
      : [];
  });
}

function stringFragments(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.flatMap((span) => [
        ...stringFragments(span.expression),
        span.literal.text,
      ]),
    ];
  }
  return node.getChildren().flatMap(stringFragments);
}

function buttonClasses(path) {
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buttons = [];

  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "button"
    ) {
      const classAttribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "className",
      );
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const location = `${relative(repositoryRoot, path)}:${line}`;
      const typeAttribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "type",
      );
      const disabledAttribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "disabled",
      );
      assert.ok(typeAttribute, `${location} needs an explicit button type`);
      assert.ok(classAttribute && ts.isJsxAttribute(classAttribute), `${location} needs a styled className`);
      assert.ok(classAttribute.initializer, `${location} has an empty className`);

      const fragments = ts.isStringLiteral(classAttribute.initializer)
        ? [classAttribute.initializer.text]
        : ts.isJsxExpression(classAttribute.initializer) && classAttribute.initializer.expression
          ? stringFragments(classAttribute.initializer.expression)
          : [];
      const classes = new Set(
        fragments.flatMap((fragment) => fragment.match(/\b(?:kiri|library|ocr)-[\w-]+\b/g) ?? []),
      );
      assert.ok(classes.size > 0, `${location} needs a project interaction class`);
      buttons.push({ location, classes: [...classes], hasDisabled: Boolean(disabledAttribute) });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return buttons;
}

const componentFiles = filesUnder(sourceRoot, [".tsx"]);
const styleFiles = filesUnder(sourceRoot, [".css", ".tsx"]);
const styleSource = styleFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const styleRules = [...styleSource.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .flatMap((match) => match[1]
      .split(",")
      .map((selector) => ({ selector, declarations: match[2] })));
const visiblyChanges = (declarations) =>
  [...declarations.matchAll(/([\w-]+)\s*:\s*([^;}]+)/g)].some((match) =>
    /^(?:background(?:-color)?|border(?:-color)?|box-shadow|color|opacity|transform|text-decoration)$/i
      .test(match[1]) && match[2].trim().toLowerCase() !== "none",
  );

function hasVisibleClassState(classes, state, rules = styleRules) {
  return classes.some((className) =>
    rules.some(({ selector, declarations }) => {
      const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const positiveSelector = selector.replace(/:not\([^)]*\)/g, "");
      const statefulClass = new RegExp(
        `\\.${escapedClass}(?![\\w-])(?:(?![\\s>+~,.]).)*${state}`,
      );
      return statefulClass.test(positiveSelector) && visiblyChanges(declarations);
    }),
  );
}

test("state matching rejects negated selectors and no-op declarations", () => {
  assert.equal(
    hasVisibleClassState(["sample"], ":disabled", [
      { selector: ".sample:hover:not(:disabled)", declarations: "opacity: 0.8" },
    ]),
    false,
  );
  assert.equal(
    hasVisibleClassState(["sample"], ":disabled", [
      { selector: ".sample:disabled", declarations: "opacity: 0.45" },
    ]),
    true,
  );
  assert.equal(
    hasVisibleClassState(["sample"], ":hover", [
      { selector: ".sample:hover", declarations: "transform: none" },
    ]),
    false,
  );
});

test("every native button uses a class with a stylesheet hover state", () => {

  for (const button of componentFiles.flatMap(buttonClasses)) {
    const hasHoverState = hasVisibleClassState(button.classes, ":hover");
    assert.ok(
      hasHoverState,
      `${button.location} needs a visible :hover state through one of: ${button.classes.join(", ")}`,
    );
  }
});

test("buttons that can be disabled keep a visible disabled state", () => {
  for (const button of componentFiles.flatMap(buttonClasses).filter((entry) => entry.hasDisabled)) {
    assert.ok(
      hasVisibleClassState(button.classes, ":disabled"),
      `${button.location} needs a visible :disabled state through one of: ${button.classes.join(", ")}`,
    );
  }
});

test("the shared control contract keeps focus, press, and disabled states", () => {
  const designSystem = readFileSync(join(sourceRoot, "styles", "design-system.css"), "utf8");
  const selectors = [...designSystem.matchAll(/([^{}]+)\{/g)].map((match) => match[1]);
  assert.ok(
    selectors.some((selector) => selector.includes("button") && selector.includes(":focus-visible")),
  );
  assert.match(designSystem, /button:active:not\(:disabled\)\s*\{/);
  assert.match(designSystem, /button:disabled\s*\{/);
  assert.doesNotMatch(designSystem, /\*:focus\s*\{[^}]*outline:\s*none/);
});

test("hover feedback stays in stylesheets instead of pointer event mutation", () => {
  const windowSource = filesUnder(join(sourceRoot, "windows"), [".tsx"])
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    windowSource,
    /currentTarget\.style\.(?:background|boxShadow|color|opacity|transform)\s*=/,
  );
});
