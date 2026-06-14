import React from 'react';

export function contrastColor(hex) {
  if (!hex || hex.length < 7) return '#000';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}

export default function TagBadge({ tag, active, onClick, onRemove }) {
  const bg = tag.color || '#6c757d';
  const fg = contrastColor(bg);
  const border = active ? `2px solid ${fg}` : '2px solid transparent';

  return (
    <span
      onClick={onClick}
      style={{
        background: bg,
        color: fg,
        border,
        padding: '1px 5px',
        borderRadius: '3px',
        fontSize: '11px',
        cursor: onClick ? 'pointer' : 'default',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        userSelect: 'none',
      }}
    >
      {tag.name}
      {onRemove && (
        <span
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ cursor: 'pointer', fontWeight: 'bold', lineHeight: 1 }}
        >
          ×
        </span>
      )}
    </span>
  );
}
