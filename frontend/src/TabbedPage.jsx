import React, { useMemo } from 'react';
import { Container, Tab, Nav } from 'react-bootstrap';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { hooks } from './plugins/hooks';

// Reusable tabbed page whose active tab is bound to a URL path segment
// (basePath/:tab). Used by both AccountPage and AdminPage.
//
// Props:
//   title       – heading shown above the tabs
//   basePath    – route base without the tab segment (e.g. "/account")
//   builtinTabs – [{ key, title, render: () => JSX }], first entry is the default tab
//   hookName    – plugin hook name to pull extra tabs from (e.g. "account_tabs")
//   tabProps    – optional object spread as props into each hook tab's <Component />
export default function TabbedPage({ title, basePath, builtinTabs, hookName, tabProps }) {
  const { tab } = useParams();
  const navigate = useNavigate();

  const extraTabs = useMemo(() => hooks.run[hookName](), [hookName]);
  const defaultKey = builtinTabs[0].key;
  const allKeys = useMemo(
    () => [...builtinTabs.map(t => t.key), ...extraTabs.map(t => t.key)],
    [builtinTabs, extraTabs]
  );

  if (!tab || !allKeys.includes(tab)) {
    return <Navigate to={`${basePath}/${defaultKey}`} replace />;
  }

  return (
    <Container className="mt-4">
      <h2 className="mb-3">{title}</h2>

      <Tab.Container activeKey={tab} onSelect={key => navigate(`${basePath}/${key}`)}>
        <Nav variant="tabs" className="mb-3">
          {builtinTabs.map(({ key, title: tabTitle }) => (
            <Nav.Item key={key}>
              <Nav.Link eventKey={key}>{tabTitle}</Nav.Link>
            </Nav.Item>
          ))}
          {extraTabs.map(({ key, title: tabTitle }) => (
            <Nav.Item key={key}>
              <Nav.Link eventKey={key}>{tabTitle}</Nav.Link>
            </Nav.Item>
          ))}
        </Nav>

        <Tab.Content>
          {builtinTabs.map(({ key, render }) => (
            <Tab.Pane key={key} eventKey={key}>
              {render()}
            </Tab.Pane>
          ))}
          {extraTabs.map(({ key, Component }) => (
            <Tab.Pane key={key} eventKey={key}>
              <Component {...tabProps} />
            </Tab.Pane>
          ))}
        </Tab.Content>
      </Tab.Container>
    </Container>
  );
}
