import React from 'react';
import TagBadge from './TagBadge';

export default function TagFilterBar({ projectTags, selectedTagIds, onToggle }) {
  if (!projectTags || projectTags.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      alignItems: 'center',
      padding: '4px 8px',
      borderBottom: '1px solid #dee2e6',
      background: '#f8f9fa',
      minHeight: '32px',
    }}>
      <span style={{ fontSize: '11px', color: '#6c757d', marginRight: '4px' }}>Filter:</span>
      {projectTags.map(tag => (
        <TagBadge
          key={tag.id}
          tag={tag}
          active={selectedTagIds.has(tag.id)}
          onClick={() => onToggle(tag.id)}
        />
      ))}
      {selectedTagIds.size > 0 && (
        <span
          onClick={() => [...selectedTagIds].forEach(id => onToggle(id))}
          style={{ fontSize: '11px', color: '#6c757d', cursor: 'pointer', textDecoration: 'underline' }}
        >
          clear
        </span>
      )}
    </div>
  );
}
