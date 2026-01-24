import React, { useContext } from 'react';
import { Dropdown } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { setAuthToken } from './datamodel/api';

export default function UserMenu() {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setAuthToken(null);
  };

  const handleAccountClick = () => {
    navigate('/account');
  };

  if (!user) {
    return null;
  }

  return (
    <Dropdown>
      <Dropdown.Toggle variant="outline-light" size="sm">
        {user.username}
      </Dropdown.Toggle>
      <Dropdown.Menu align="end">
        <Dropdown.Header>Balance: ${user.balance.toFixed(2)}</Dropdown.Header>
        <Dropdown.Divider />
        <Dropdown.Item onClick={handleAccountClick}>Account</Dropdown.Item>
        <Dropdown.Item onClick={handleLogout}>Log Out</Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}
