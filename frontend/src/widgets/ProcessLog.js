import React, { useContext, useEffect, useRef, useState } from 'react';
import { ProcessContext } from '../ProcessContext';

function ProcessLog() {
  const { activeProcess, processes } = useContext(ProcessContext);
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState(null);
  const logContainerRef = useRef(null);
  const wsRef = useRef(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!activeProcess) {
      setLogs([]);
      setState(null);
      return;
    }

    const { processId, version } = activeProcess;

    // Find process and version state
    const process = processes.find(p => p.id === processId);
    if (!process) {
      setLogs([]);
      setState(null);
      return;
    }

    const versionObj = process.versions.find(v => v.version === version);
    if (!versionObj) {
      setLogs([]);
      setState(null);
      return;
    }

    setState(versionObj.state);

    // If process is running, connect to WebSocket for live logs
    if (versionObj.state === 'running' || versionObj.state === 'queued') {
      const ws = new WebSocket(`ws://localhost:8000/ws/process/${processId}/logs?version=${version}`);

      ws.onopen = () => {
        console.log('WebSocket connected for process logs');
      };

      ws.onmessage = (event) => {
        const logEntry = JSON.parse(event.data);
        setLogs(prev => [...prev, logEntry]);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
      };

      wsRef.current = ws;

      // Clean up on unmount or when dependencies change
      return () => {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    } else {
      // For done or failed processes, fetch logs via REST API
      fetch(`http://localhost:8000/process/${processId}/logs?version=${version}`)
        .then(res => res.json())
        .then(data => {
          // Backend returns an array of logs directly
          setLogs(Array.isArray(data) ? data : []);
          // State is already set from versionObj above
        })
        .catch(err => {
          console.error('Failed to fetch logs:', err);
          setLogs([]);
        });
    }
  }, [activeProcess, processes]);

  if (!activeProcess) {
    return (
      <div className="p-3 text-center text-muted">
        <p>No process selected</p>
        <small>Select a process from the flow view to see its logs</small>
      </div>
    );
  }

  const getStateBadge = () => {
    if (!state) return null;

    const badges = {
      queued: <span className="badge bg-secondary">Queued</span>,
      running: <span className="badge bg-primary">Running</span>,
      done: <span className="badge bg-success">Done</span>,
      failed: <span className="badge bg-danger">Failed</span>
    };

    return badges[state] || null;
  };

  return (
    <div className="d-flex flex-column h-100">
      <div className="p-2 border-bottom d-flex justify-content-between align-items-center">
        <small className="text-muted">Process Logs</small>
        {getStateBadge()}
      </div>
      <div
        ref={logContainerRef}
        className="flex-grow-1 overflow-auto p-3"
        style={{
          fontFamily: 'monospace',
          fontSize: '0.875rem',
          backgroundColor: '#f8f9fa'
        }}
      >
        {!logs || logs.length === 0 ? (
          <div className="text-muted text-center">
            {state === 'queued' ? 'Waiting for process to start...' : 'No logs available'}
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="mb-1">
              <span className="text-muted me-2">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

ProcessLog.title = "Process Log";

export default ProcessLog;
