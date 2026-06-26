import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

export default function PaneMenuDropdown({ anchorRef, onClose, children }) {
  const dropdownRef = useRef(null);
  const rect = anchorRef.current?.getBoundingClientRect();

  useEffect(() => {
    const handler = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (!rect) return null;

  return ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      className="pane-menu-dropdown"
      style={{ position: 'fixed', top: rect.bottom, right: window.innerWidth - rect.right, zIndex: 9999 }}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}
