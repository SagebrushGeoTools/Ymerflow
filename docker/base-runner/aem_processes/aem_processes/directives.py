"""SimPEG directives for inversion monitoring and logging."""

import numpy as np
import SimPEG.directives


class ReportingDirective(SimPEG.directives.InversionDirective):
    """Directive to log inversion progress."""

    def __init__(self):
        self.logs = []

    def log(self, data):
        self.logs.append(data)
        print(f"Inversion step: {data}")

    def calc_rmse(self, status):
        n_data = np.sum(self.invProb.dmisfit.W.diagonal() > 0)
        status['rmse_d'] = float(np.sqrt((status['phi_d'] * 2) / n_data))
        status['rmse_m'] = float(np.sqrt((status['phi_m'] * 2) / n_data))
        status['rmse_m_scaled'] = float(np.sqrt((status['phi_m_scaled'] * 2) / n_data))
        status['rmse_total'] = float(np.sqrt(status['rmse_d']**2 + status['rmse_m_scaled']**2))

    def endIter(self):
        status = {
            "step": int(self.opt.iter + 2),
            'iter': int(self.opt.iter),
            'beta': float(self.invProb.beta),
            "phi_d": float(self.opt.parent.phi_d * self.opt.parent.opt.factor),
            "phi_m": float(self.opt.parent.phi_m * self.opt.parent.opt.factor),
            'phi_m_scaled': float(self.invProb.phi_m * self.opt.factor * self.invProb.beta),
            "f": float(self.opt.f),
            "|proj(x-g)-x|": float(np.linalg.norm(self.opt.projection(self.opt.xc - self.opt.g) - self.opt.xc)),
            "status": "update"
        }
        self.calc_rmse(status)
        self.log(status)

    def initialize(self):
        self.log({"step": 1, "status": "initialize"})

    def finish(self):
        self.log({"step": int(self.opt.iter + 2), "status": "end"})


class SaveOutputEveryIteration(SimPEG.directives.InversionDirective):
    """Directive to save intermediate models."""

    def __init__(self, system, iteration_datasets):
        """Initialize directive.

        Args:
            system: The inversion system instance
            iteration_datasets: List to append iteration data to
        """
        self.system = system
        self.iteration_datasets = iteration_datasets

    def endIter(self):
        # Save intermediate datasets
        iter_num = self.opt.iter
        system = self.system

        try:
            model_xyz = system.inverted_model_to_xyz(
                system.inv.invProb.model,
                system.inv.invProb.dmisfit.simulation.thicknesses
            )
            model_xyz.normalize(naming_standard="alc")

            synthetic_xyz = system.forward_data_to_xyz(
                system.inv.invProb.dpred,
                inversion=True
            )
            synthetic_xyz.normalize(naming_standard="alc")

            # Store for later saving
            self.iteration_datasets.append({
                'iter': iter_num,
                'model': model_xyz,
                'synthetic': synthetic_xyz
            })

        except Exception as e:
            print(f"Warning: Failed to save iteration {iter_num}: {e}")
