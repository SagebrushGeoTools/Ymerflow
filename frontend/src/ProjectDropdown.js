import React, { useContext, useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import { ProcessContext } from './ProcessContext';
import { useCreateProject } from './datamodel/useQueries';
import ProjectModal from './ProjectModal';

function ProjectDropdown() {
  const { projects, currentProject, setCurrentProject, projectsLoading } = useContext(ProcessContext);
  const createProjectMutation = useCreateProject();
  const [showModal, setShowModal] = useState(false);

  const currentProjectObj = projects.find(p => p.id === currentProject);

  const handleProjectSelect = (projectId) => {
    if (projectId === '_create_new') {
      setShowModal(true);
    } else {
      setCurrentProject(projectId);
    }
  };

  const handleCreateProject = async (name) => {
    try {
      const newProject = await createProjectMutation.mutateAsync(name);
      setCurrentProject(newProject.id);
      setShowModal(false);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  if (projectsLoading) {
    return <span className="navbar-text">Loading projects...</span>;
  }

  return (
    <>
      <Dropdown onSelect={handleProjectSelect}>
        <Dropdown.Toggle variant="outline-secondary" size="sm">
          Project: {currentProjectObj ? currentProjectObj.name : 'None'}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {projects.map((project) => (
            <Dropdown.Item
              key={project.id}
              eventKey={project.id}
              active={project.id === currentProject}
            >
              {project.name}
            </Dropdown.Item>
          ))}
          {projects.length > 0 && <Dropdown.Divider />}
          <Dropdown.Item eventKey="_create_new">
            Create New Project...
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>

      <ProjectModal
        show={showModal}
        onHide={() => setShowModal(false)}
        onSubmit={handleCreateProject}
      />
    </>
  );
}

export default ProjectDropdown;
