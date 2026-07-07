import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Form } from 'react-bootstrap';
import { byEpsg } from 'projnames';

// Build sorted array of {code, name} once at module load
const allEpsgCodes = Object.entries(byEpsg)
  .map(([code, name]) => ({ code: parseInt(code), name }))
  .sort((a, b) => a.code - b.code);

function formatEntry(code, name) {
  return `${code}: ${name}`;
}

export default function EPSGSelector({ value, onChange, id, required }) {
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef(null);

  // Set display value when value prop changes
  useEffect(() => {
    if (value != null) {
      const entry = allEpsgCodes.find(c => c.code === value);
      setSearchText(entry ? formatEntry(entry.code, entry.name) : String(value));
    } else {
      setSearchText('');
    }
  }, [value]);

  const filteredCodes = useMemo(() => {
    if (!searchText) return allEpsgCodes.slice(0, 50);
    const search = searchText.toLowerCase();
    return allEpsgCodes
      .filter(c => c.code.toString().includes(search) || c.name.toLowerCase().includes(search) || formatEntry(c.code, c.name).toLowerCase().includes(search))
      .slice(0, 50);
  }, [searchText]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    setSearchText(e.target.value);
    setShowDropdown(true);
  };

  const handleSelect = (entry) => {
    setSearchText(formatEntry(entry.code, entry.name));
    onChange(entry.code);
    setShowDropdown(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <Form.Control
        type="text"
        id={id}
        value={searchText}
        onChange={handleInputChange}
        onFocus={() => setShowDropdown(true)}
        placeholder="Search by code or name (e.g. '25833' or 'UTM 33')"
        required={required}
      />

      {showDropdown && filteredCodes.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: '300px',
          overflowY: 'auto',
          backgroundColor: 'white',
          border: '1px solid #ced4da',
          borderRadius: '0.25rem',
          zIndex: 1000,
          marginTop: '2px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          {filteredCodes.map(entry => (
            <div
              key={entry.code}
              onClick={() => handleSelect(entry)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
                backgroundColor: entry.code === value ? '#e7f3ff' : 'white',
                fontSize: '14px'
              }}
              onMouseEnter={(e) => { if (entry.code !== value) e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
              onMouseLeave={(e) => { if (entry.code !== value) e.currentTarget.style.backgroundColor = 'white'; }}
            >
              {formatEntry(entry.code, entry.name)}
            </div>
          ))}
          {filteredCodes.length === 50 && (
            <div style={{ padding: '6px 12px', fontSize: '12px', color: '#6c757d', fontStyle: 'italic', textAlign: 'center' }}>
              Showing first 50 results — type to filter
            </div>
          )}
        </div>
      )}

      {showDropdown && filteredCodes.length === 0 && searchText && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: 'white',
          border: '1px solid #ced4da',
          borderRadius: '0.25rem',
          zIndex: 1000,
          marginTop: '2px',
          padding: '8px 12px',
          color: '#6c757d',
          fontSize: '14px'
        }}>
          No matching EPSG codes found
        </div>
      )}
    </div>
  );
}
