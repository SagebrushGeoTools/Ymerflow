import React, { useState, useEffect, useRef } from 'react';
import { Form } from 'react-bootstrap';

const API = "http://localhost:8000";

/**
 * EPSG code selector with search/filter functionality
 * Displays "EPSG:code - Name" for easy searching by either code or name
 */
export default function EPSGSelector({ value, onChange, id, required }) {
  const [searchText, setSearchText] = useState('');
  const [allEpsgCodes, setAllEpsgCodes] = useState([]);
  const [filteredCodes, setFilteredCodes] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const wrapperRef = useRef(null);

  // Load EPSG codes on mount
  useEffect(() => {
    fetch(`${API}/utilities/epsg-codes`)
      .then(r => r.json())
      .then(codesDict => {
        // Convert dict {code: name} to array [{code, name}]
        const codesArray = Object.entries(codesDict).map(([code, name]) => ({
          code: parseInt(code),
          name: name
        }));
        setAllEpsgCodes(codesArray);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load EPSG codes:', err);
        setLoading(false);
        setAllEpsgCodes([]);
      });
  }, []);

  // Set initial display value based on selected code
  useEffect(() => {
    if (value && allEpsgCodes.length > 0) {
      const selected = allEpsgCodes.find(c => c.code === value);
      if (selected) {
        setSearchText(`EPSG:${selected.code} - ${selected.name}`);
      } else {
        setSearchText(`EPSG:${value}`);
      }
    } else if (!value) {
      setSearchText('');
    }
  }, [value, allEpsgCodes]);

  // Filter codes based on search text
  useEffect(() => {
    if (!searchText || searchText.length === 0) {
      // Show all codes when no search text
      setFilteredCodes(allEpsgCodes.slice(0, 50)); // Limit initial display
    } else {
      const search = searchText.toLowerCase();
      const filtered = allEpsgCodes.filter(c => {
        const codeStr = c.code.toString();
        const nameStr = c.name.toLowerCase();
        return codeStr.includes(search) || nameStr.includes(search);
      });
      setFilteredCodes(filtered.slice(0, 50)); // Limit to 50 results
    }
  }, [searchText, allEpsgCodes]);

  // Handle click outside to close dropdown
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

  const handleInputFocus = () => {
    setShowDropdown(true);
  };

  const handleSelect = (code) => {
    const selected = allEpsgCodes.find(c => c.code === code);
    if (selected) {
      setSearchText(`EPSG:${selected.code} - ${selected.name}`);
      onChange(code);
      setShowDropdown(false);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <Form.Control
        type="text"
        id={id}
        value={searchText}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        placeholder={loading ? "Loading EPSG codes..." : "Search by code or name (e.g., '25833' or 'UTM 33')"}
        required={required}
        disabled={loading}
      />

      {showDropdown && !loading && filteredCodes.length > 0 && (
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
          {filteredCodes.map(code => (
            <div
              key={code.code}
              onClick={() => handleSelect(code.code)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid #f0f0f0',
                backgroundColor: code.code === value ? '#e7f3ff' : 'white'
              }}
              onMouseEnter={(e) => {
                if (code.code !== value) {
                  e.target.style.backgroundColor = '#f8f9fa';
                }
              }}
              onMouseLeave={(e) => {
                if (code.code !== value) {
                  e.target.style.backgroundColor = 'white';
                }
              }}
            >
              <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
                EPSG:{code.code}
              </div>
              <div style={{ fontSize: '12px', color: '#6c757d' }}>
                {code.name}
              </div>
            </div>
          ))}
          {filteredCodes.length === 50 && allEpsgCodes.length > 50 && (
            <div style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: '#6c757d',
              fontStyle: 'italic',
              textAlign: 'center'
            }}>
              Showing first 50 results. Type to filter...
            </div>
          )}
        </div>
      )}

      {showDropdown && !loading && filteredCodes.length === 0 && searchText && (
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
