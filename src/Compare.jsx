import React, { useEffect, useRef, useState } from "react";
export default function Compare({ left, right, slider, close }) {
  const dialog = useRef(null),
    drag = useRef(null);
  const [mode, Mode] = useState(slider ? "wipe" : "side"),
    [position, Position] = useState(50),
    [zoom, Zoom] = useState(1),
    [offset, Offset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const focus = document.activeElement;
    dialog.current.showModal();
    return () => focus?.focus();
  }, []);
  const sameAspect =
    Math.abs(left.width / left.height - right.width / right.height) < 0.01;
  const wipe = mode === "wipe" && sameAspect;
  const image = (v) => (
    <img
      src={v.url}
      alt={v.label}
      draggable={false}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
      }}
    />
  );
  return (
    <dialog
      ref={dialog}
      className="compare-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2>Compare & observe</h2>
          <small>
            Linked zoom and pan ·{" "}
            {left.thumbnail
              ? "Source preview up to 768 px"
              : "Original output files"}
          </small>
        </div>
        <div className="actions">
          <button onClick={() => Mode("side")} aria-pressed={mode === "side"}>
            Side by side
          </button>
          {slider && (
            <button
              disabled={!sameAspect}
              onClick={() => Mode("wipe")}
              aria-pressed={wipe}
            >
              Wipe
            </button>
          )}
          <button onClick={() => Zoom((v) => Math.max(1, v / 1.25))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => Zoom((v) => Math.min(8, v * 1.25))}>＋</button>
          <button
            onClick={() => {
              Zoom(1);
              Offset({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
          <button onClick={close}>Close</button>
        </div>
      </header>
      <div className="compare-labels">
        <strong>A · {left.label}</strong>
        <strong>B · {right.label}</strong>
      </div>
      <div
        className={`compare-stage ${wipe ? "wipe" : "side"}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            Offset({
              x: e.clientX - drag.current.x,
              y: e.clientY - drag.current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="compare-pane">{image(left)}</div>
        <div
          className="compare-pane second"
          style={wipe ? { clipPath: `inset(0 0 0 ${position}%)` } : undefined}
        >
          {image(right)}
        </div>
      </div>
      {wipe && (
        <label className="wipe-control">
          Original ←{" "}
          <input
            aria-label="Comparison reveal position"
            type="range"
            min="0"
            max="100"
            value={position}
            onChange={(e) => Position(+e.target.value)}
          />{" "}
          → Generated
        </label>
      )}
      {!sameAspect && slider && (
        <p>
          Different aspect ratios: side-by-side comparison preserves both
          images.
        </p>
      )}
      <details>
        <summary>Prompts & parameter differences</summary>
        <div className="text-compare">
          <div>
            <pre>{left.prompt || "Source image"}</pre>
            <pre>{JSON.stringify(left.settings || {}, null, 2)}</pre>
          </div>
          <div>
            <pre>{right.prompt}</pre>
            <pre>
              {Object.keys(right.settings || {})
                .filter((k) => right.settings[k] !== left.settings?.[k])
                .map(
                  (k) =>
                    `${k}: ${left.settings?.[k] ?? "—"} → ${right.settings[k]}`,
                )
                .join("\n") || "Same parameters"}
            </pre>
          </div>
        </div>
      </details>
    </dialog>
  );
}
