import React from 'react';
import TagInput from './TagInput';

const CONTAINER_STYLE = {
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  borderBottom: '1px solid #dee2e6',
  borderRadius: 0,
  background: '#f8f9fa',
  padding: '4px 8px',
};

export default function TagFilterBar({ projectTags, selectedTagIds, onToggle }) {
  if (!projectTags || projectTags.length === 0) return null;

  const selectedTags = projectTags.filter(t => selectedTagIds.has(t.id));
  const availableTags = projectTags.filter(t => !selectedTagIds.has(t.id));

  const handleAdd = async (name) => {
    const tag = projectTags.find(t => t.name === name);
    if (tag) onToggle(tag.id);
  };

  const handleRemove = async (tagId) => {
    onToggle(tagId);
  };

  return (
    <TagInput
      selectedTags={selectedTags}
      availableTags={availableTags}
      onAdd={handleAdd}
      onRemove={handleRemove}
      listId="tag-filter-opts"
      placeholder="Filter by tag…"
      containerStyle={CONTAINER_STYLE}
    />
  );
}
