import React from "react";

const roles = [
  {
    name: "Source image",
    hint: "Original artwork to edit",
    number: "image1",
    icon: "▧",
  },
  {
    name: "Target image",
    hint: "Face reference to transfer",
    number: "image2",
    icon: "◎",
  },
];

export default function InputSlots({
  images,
  busy,
  select,
  drop,
  remove,
  view,
}) {
  return (
    <div className="input-slots">
      {roles.map((role, i) => (
        <section
          key={role.number}
          aria-label={role.name}
          className={`input-slot ${images[i] ? "filled" : ""}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) drop(i, Array.from(e.dataTransfer.files));
          }}
        >
          <div className="slot-heading">
            <strong>{role.name}</strong>
            <span>{role.number}</span>
          </div>
          <p>{role.hint}</p>
          <button
            className="slot-preview"
            disabled={busy}
            aria-label={images[i] ? `View ${role.name}` : `Upload ${role.name}`}
            onClick={() => (images[i] ? view(images[i]) : select(i))}
          >
            {images[i] ? (
              <img
                src={images[i].previewUrl}
                alt={`${role.name}: ${images[i].name}`}
              />
            ) : (
              <>
                <span className="slot-icon" aria-hidden="true">
                  {role.icon}
                </span>
                <span>Drop or choose image</span>
                <small>PNG · JPEG · WebP</small>
              </>
            )}
          </button>
          {images[i] && (
            <>
              <small className="slot-filename" title={images[i].name}>
                {images[i].name}
              </small>
              <div className="slot-controls">
                <small>
                  {images[i].width} × {images[i].height}
                </small>
                <button
                  disabled={busy}
                  onClick={() => select(i)}
                  aria-label={`Replace ${role.name}`}
                >
                  Replace
                </button>
                <button
                  disabled={busy}
                  onClick={() => remove(i)}
                  aria-label={`Remove ${role.name}`}
                >
                  ×
                </button>
              </div>
            </>
          )}
        </section>
      ))}
      <p className="input-order">
        <strong>Fixed API order</strong>image1 · Source → image2 · Target
      </p>
    </div>
  );
}
