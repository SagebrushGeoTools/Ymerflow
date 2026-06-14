import React, { useState, useContext, useRef } from 'react';
import { ProcessContext } from '../../ProcessContext';
import { useProjectTags, useCreateTag, useAddVersionTag, useRemoveVersionTag } from '../../datamodel/useQueries';
import TagBadge from './TagBadge';

const TAG_COLORS = ['#007bff', '#28a745', '#dc3545', '#fd7e14', '#6f42c1', '#20c997', '#e83e8c'];

export default function TagSelector({ processId, version, currentTags = [], projectId }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const { invalidateProject } = useContext(ProcessContext);
  const { data: projectTags = [] } = useProjectTags(projectId);
  const createTag = useCreateTag(projectId);
  const addVersionTag = useAddVersionTag();
  const removeVersionTag = useRemoveVersionTag();

  const listId = `tag-opts-${processId}-${version}`;
  const currentTagIds = new Set(currentTags.map(t => t.id));

  const handleAdd = async () => {
    const name = inputValue.trim();
    if (!name) return;

    let tag = projectTags.find(t => t.name === name);
    if (!tag) {
      const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      try {
        tag = await createTag.mutateAsync({ name, color });
      } catch {
        return;
      }
    }

    if (!currentTagIds.has(tag.id)) {
      try {
        await addVersionTag.mutateAsync({ processId, version, tagId: tag.id });
        await invalidateProject(projectId);
      } catch {
        /* ignore */
      }
    }
    setInputValue('');
    inputRef.current?.focus();
  };

  const handleRemove = async (tagId) => {
    try {
      await removeVersionTag.mutateAsync({ processId, version, tagId });
      await invalidateProject(projectId);
    } catch {
      /* ignore */
    }
  };

  const availableTags = projectTags.filter(t => !currentTagIds.has(t.id));

  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}
      onClick={(e) => e.stopPropagation()}
    >
      {currentTags.map(tag => (
        <TagBadge
          key={tag.id}
          tag={tag}
          onRemove={() => handleRemove(tag.id)}
        />
      ))}
      <input
        ref={inputRef}
        list={listId}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            handleAdd();
          }
        }}
        placeholder="Add tag…"
        style={{
          border: '1px solid #ccc',
          borderRadius: '3px',
          outline: 'none',
          fontSize: '11px',
          padding: '1px 4px',
          width: '80px',
          background: 'white',
        }}
      />
      <datalist id={listId}>
        {availableTags.map(t => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}
