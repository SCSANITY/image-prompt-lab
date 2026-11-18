import React, { useState } from 'react'
import { parseSize } from '../core/contract.mjs'

const SIZE_GROUPS = [
  { label: 'Square', sizes: ['1024x1024', '1536x1536', '2048x2048'] },
  { label: 'Landscape', sizes: ['1536x1024', '2048x1536', '2560x1440', '3072x2048', '3840x2160'] },
  { label: 'Portrait', sizes: ['1024x1536', '1536x2048', '1440x2560', '2048x3072', '2160x3840'] },
]

export default function SizeSelect({ value, onChange }) {
  const [custom, setCustom] = useState(false)
  let size
  let error
  try {
    size = parseSize(value)
  } catch (cause) {
    error = cause.message
  }

  return (
    <div className="size-field">
      <label>Size
        <select
          value={custom ? 'custom' : value}
          onChange={event => {
            const next = event.target.value
            setCustom(next === 'custom')
            if (next !== 'custom') onChange(next)
            else if (value === 'auto') onChange('')
          }}
        >
          <option value="auto">Auto</option>
          {SIZE_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.sizes.map(preset => (
                <option key={preset} value={preset}>{preset.replace('x', ' × ')}</option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Custom size…</option>
        </select>
      </label>
      {custom && <>
        <label>Custom size
          <input
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder="Width × height, e.g. 1536x864"
            aria-describedby="custom-size-help"
            aria-invalid={Boolean(error)}
            required
          />
        </label>
        <small id="custom-size-help">Enter WIDTHxHEIGHT. Both dimensions must be multiples of 16.</small>
      </>}
      {error && value && <small className="error" role="status">{error}</small>}
      {size?.experimental && <small className="size-note">OpenAI classifies this resolution as experimental.</small>}
    </div>
  )
}
