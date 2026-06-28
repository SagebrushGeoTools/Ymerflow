import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { setAuthToken } from './datamodel/api';
import { useRegisterMenu, useRegisterMenuComponent } from './flexout/MenuContext';
import { hooks } from './plugins/hooks';

// Renders any items contributed by plugins via the user_menu_extra_items hook.
// Plugins (e.g. billing) register their components through that hook.
function UserMenuExtras() {
  return <>{hooks.run_jsx.user_menu_extra_items()}</>;
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

  useRegisterMenuComponent([menuName, 'Balance'], UserMenuExtras, -1);
  useRegisterMenu([menuName, 'Account'], handleAccountClick, 1);
  useRegisterMenu([menuName, 'Log Out'], handleLogout, 2);

  return null;
}
