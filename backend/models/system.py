from sqlalchemy import Column, String, DateTime, LargeBinary
from datetime import datetime
import uuid
import msgpack
import msgpack_numpy as m

from backend.database import Base

# Configure msgpack to handle numpy arrays
m.patch()


class System(Base):
    __tablename__ = "systems"

    id = Column(String(255), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    gex = Column(LargeBinary, nullable=False)  # Store msgpack bytes
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        """Convert to API response format"""
        # Deserialize msgpack and convert numpy arrays to lists for JSON
        gex_data = msgpack.unpackb(self.gex, raw=False)
        return {
            "id": self.id,
            "name": self.name,
            "gex": self._numpy_to_list(gex_data),
            "created_at": self.created_at.isoformat()
        }

    @staticmethod
    def _numpy_to_list(obj):
        """Recursively convert numpy arrays to lists for JSON serialization"""
        import numpy as np
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, dict):
            return {k: System._numpy_to_list(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [System._numpy_to_list(item) for item in obj]
        elif isinstance(obj, (np.integer, np.floating)):
            return obj.item()
        return obj
