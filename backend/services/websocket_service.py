from typing import Dict, List
from fastapi import WebSocket


class WebSocketManager:
    """Manages WebSocket connections for process logs and state updates"""

    def __init__(self):
        # process_id -> list of websockets
        self.log_connections: Dict[str, List[WebSocket]] = {}
        # Global state update connections
        self.state_connections: List[WebSocket] = []

    async def connect_logs(self, process_id: str, websocket: WebSocket):
        """Connect a websocket to process logs"""
        if process_id not in self.log_connections:
            self.log_connections[process_id] = []
        self.log_connections[process_id].append(websocket)

    async def disconnect_logs(self, process_id: str, websocket: WebSocket):
        """Disconnect a websocket from process logs"""
        if process_id in self.log_connections:
            if websocket in self.log_connections[process_id]:
                self.log_connections[process_id].remove(websocket)
            # Clean up empty lists
            if not self.log_connections[process_id]:
                del self.log_connections[process_id]

    async def broadcast_log(self, process_id: str, log_entry: dict):
        """Broadcast a log entry to all connected websockets for a process"""
        if process_id not in self.log_connections:
            return

        disconnected = []
        for ws in self.log_connections[process_id]:
            try:
                await ws.send_json(log_entry)
            except Exception:
                disconnected.append(ws)

        # Remove disconnected websockets
        for ws in disconnected:
            await self.disconnect_logs(process_id, ws)

    async def connect_state(self, websocket: WebSocket):
        """Connect a websocket to global state updates"""
        self.state_connections.append(websocket)

    async def disconnect_state(self, websocket: WebSocket):
        """Disconnect a websocket from global state updates"""
        if websocket in self.state_connections:
            self.state_connections.remove(websocket)

    async def broadcast_state(self, message: dict):
        """Broadcast a state update to all connected websockets"""
        import logging
        logger = logging.getLogger(__name__)

        logger.info(f"Broadcasting state to {len(self.state_connections)} clients: {message}")
        disconnected = []
        for ws in self.state_connections:
            try:
                await ws.send_json(message)
                logger.info(f"Sent state update to client {id(ws)}")
            except Exception as e:
                logger.error(f"Failed to send state update to client {id(ws)}: {e}")
                disconnected.append(ws)

        # Remove disconnected websockets
        for ws in disconnected:
            await self.disconnect_state(ws)


# Global WebSocket manager instance
ws_manager = WebSocketManager()
