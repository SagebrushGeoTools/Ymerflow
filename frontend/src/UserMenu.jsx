import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { setAuthToken } from './datamodel/api';
import { useRegisterMenu, useRegisterMenuComponent } from './flexout/MenuContext';

// Component to display balance - updates when user balance changes
function BalanceDisplay() {
  const { user } = useContext(AuthContext);

  if (!user) {
    return null;
  }

  return (
    <span className="dropdown-header">
      Balance: ${user.balance != null ? user.balance.toFixed(2) : '—'}
    </span>
  );
}

// Main component that registers menu items
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

  
  var menuName = "Nagelfluh Geophysics: " + user?.username;
  
  useRegisterMenuComponent([menuName], null, 0);
  
  useRegisterMenuComponent([menuName, 'Balance'], BalanceDisplay, -1);
  useRegisterMenu([menuName, 'Account'], handleAccountClick, 1);
  useRegisterMenu([menuName, 'Log Out'], handleLogout, 2);

  return null;
}
