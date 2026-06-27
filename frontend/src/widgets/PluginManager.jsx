import React from 'react';
import {
  usePlugins,
  useEnablePlugin,
  useDisablePlugin,
  useUpgradePlugin,
} from '../datamodel/useQueries';

PluginManager.title = 'Plugin Manager';

export default function PluginManager() {
  const { data: plugins = [], isLoading } = usePlugins();
  const enablePlugin = useEnablePlugin();
  const disablePlugin = useDisablePlugin();
  const upgradePlugin = useUpgradePlugin();

  if (isLoading) {
    return (
      <div className="d-flex align-items-center justify-content-center h-100">
        <div className="spinner-border spinner-border-sm me-2" role="status" />
        Loading plugins...
      </div>
    );
  }

  return (
    <div className="p-3 overflow-auto">
      <h5>Plugin Manager</h5>

      <p className="text-muted small">
        To add a new plugin, build it with the Process Editor: create a{' '}
        <code>build_frontend_plugin</code> process. It registers automatically when the build
        finishes; enable it for your account below.
      </p>

      {plugins.length === 0 ? (
        <p className="text-muted">No plugins installed.</p>
      ) : (
        <table className="table table-sm table-hover">
          <thead>
            <tr>
              <th>Plugin</th>
              <th>Source</th>
              <th>Latest version</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((plugin) => (
              <tr key={plugin.id || `backend:${plugin.name}`}>
                <td>
                  <strong>{plugin.display_name || plugin.name}</strong>
                  {plugin.description && (
                    <div className="text-muted small">{plugin.description}</div>
                  )}
                </td>
                <td>
                  <span className={`badge ${plugin.source === 'backend' ? 'bg-dark' : 'bg-light text-dark'}`}>
                    {plugin.source === 'backend' ? 'Bundled' : 'Remote'}
                  </span>
                </td>
                <td className="font-monospace small">
                  {plugin.latest_version_id ? plugin.latest_version_id.slice(0, 8) : '—'}
                </td>
                <td>
                  <span className={`badge ${plugin.enabled ? 'bg-success' : 'bg-secondary'}`}>
                    {plugin.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  {plugin.upgrade_available && (
                    <span className="badge bg-info ms-1">Update available</span>
                  )}
                </td>
                <td>
                  {plugin.toggleable === false ? (
                    <span className="text-muted small">Always on</span>
                  ) : plugin.enabled ? (
                    <button
                      className="btn btn-sm btn-outline-secondary me-1"
                      onClick={() => disablePlugin.mutate(plugin.id)}
                      disabled={disablePlugin.isPending}
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm btn-outline-primary me-1"
                      onClick={() => enablePlugin.mutate(plugin.id)}
                      disabled={enablePlugin.isPending}
                    >
                      Enable
                    </button>
                  )}
                  {plugin.upgrade_available && plugin.toggleable !== false && (
                    <button
                      className="btn btn-sm btn-outline-info"
                      onClick={() => upgradePlugin.mutate(plugin.id)}
                      disabled={upgradePlugin.isPending}
                    >
                      Upgrade
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="alert alert-info small mt-2">
        Plugin changes take effect after page reload.
      </div>
    </div>
  );
}
