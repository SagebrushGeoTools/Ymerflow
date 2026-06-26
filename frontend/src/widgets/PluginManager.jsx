import React, { useState } from 'react';
import {
  usePlugins,
  useEnablePlugin,
  useDisablePlugin,
  useUpgradePlugin,
  useInstallPlugin,
  useProjects,
  useEnvironments,
} from '../datamodel/useQueries';

PluginManager.title = 'Plugin Manager';

function InstallPluginForm() {
  const { data: projects = [] } = useProjects();
  const { data: environments = [] } = useEnvironments();
  const installPlugin = useInstallPlugin();

  const [projectId, setProjectId] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [npmName, setNpmName] = useState('');
  const [npmVersion, setNpmVersion] = useState('');
  const [progress, setProgress] = useState('');

  const canSubmit = projectId && environmentId && npmName && npmVersion && !installPlugin.isPending;

  const onSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setProgress('');
    installPlugin.mutate(
      {
        projectId,
        environmentId,
        npmName: npmName.trim(),
        npmVersion: npmVersion.trim(),
        scope: 'user',
        onProgress: setProgress,
      },
      {
        onSuccess: () => {
          setNpmName('');
          setNpmVersion('');
        },
      }
    );
  };

  return (
    <div className="card mb-3">
      <div className="card-body">
        <h6 className="card-title">Install a plugin</h6>
        <p className="text-muted small mb-2">
          Build an npm source plugin into a Module-Federation remote (in a project you belong to),
          then register it for your account. The package must be present in the server-local npm
          source directory the admin maintains.
        </p>
        <form onSubmit={onSubmit}>
          <div className="row g-2">
            <div className="col-md-6">
              <label className="form-label small mb-1">Project</label>
              <select
                className="form-select form-select-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Select project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label small mb-1">Environment</label>
              <select
                className="form-select form-select-sm"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
              >
                <option value="">Select environment…</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-8">
              <label className="form-label small mb-1">npm package name</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="@scope/my-nagelfluh-plugin"
                value={npmName}
                onChange={(e) => setNpmName(e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small mb-1">Version (exact)</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="1.2.3"
                value={npmVersion}
                onChange={(e) => setNpmVersion(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2">
            <button type="submit" className="btn btn-sm btn-primary" disabled={!canSubmit}>
              {installPlugin.isPending && (
                <span className="spinner-border spinner-border-sm me-1" role="status" />
              )}
              Build &amp; install
            </button>
          </div>
        </form>
        {progress && <div className="alert alert-secondary small mt-2 mb-0">{progress}</div>}
        {installPlugin.isError && (
          <div className="alert alert-danger small mt-2 mb-0">
            {installPlugin.error?.response?.data?.detail || installPlugin.error?.message || 'Install failed.'}
          </div>
        )}
        {installPlugin.isSuccess && !installPlugin.isPending && (
          <div className="alert alert-success small mt-2 mb-0">
            Plugin installed. Reload the page to load it.
          </div>
        )}
      </div>
    </div>
  );
}

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

      <InstallPluginForm />

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
