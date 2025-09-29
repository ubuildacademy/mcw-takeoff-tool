import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { 
  Plus, 
  FolderOpen, 
  Calendar,
  Upload,
  Trash2,
  Settings,
  Download
} from 'lucide-react';
import { projectService } from '../services/apiService';
import { ProjectCreationDialog } from './ProjectCreationDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { BackupDialog } from './BackupDialog';
import { useTakeoffStore } from '../store/useTakeoffStore';

interface ApiProject {
  id: string;
  name: string;
  client?: string;
  location?: string;
  status?: string;
  lastModified?: string | Date;
  takeoffCount?: number;
  totalValue?: number;
}

export function ProjectList() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [editingProject, setEditingProject] = useState<ApiProject | null>(null);
  const [backupMode, setBackupMode] = useState<'backup' | 'restore'>('restore');
  const [selectedProjectForBackup, setSelectedProjectForBackup] = useState<ApiProject | null>(null);
  
  // Use the store
  const { projects, loadInitialData, getProjectTotalCost } = useTakeoffStore();

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        await loadInitialData();
        if (!mounted) return;
      } catch (e: any) {
        if (!mounted) return;
        setError('Could not reach server');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [loadInitialData]);

  const filteredProjects = (projects || []).filter(project =>
    (project.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.client || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.location || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleProjectClick = (projectId: string) => {
    navigate(`/job/${projectId}`);
  };

  const handleNewProject = () => setShowCreate(true);

  const handleOpenExisting = () => {
    setBackupMode('restore');
    setShowBackup(true);
  };

  const handleProjectBackup = (project: ApiProject, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the project
    setBackupMode('backup');
    setSelectedProjectForBackup(project);
    setShowBackup(true);
  };

  const handleEditProject = (project: ApiProject, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the project
    setEditingProject(project);
    setShowSettings(true);
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the project
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      try {
        await projectService.deleteProject(projectId);
        // The store will be updated when we reload the data
        await loadInitialData();
      } catch (error) {
        console.error('Failed to delete project:', error);
        alert('Failed to delete project. Please try again.');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium">Loading your projects…</div>
          {error && <div className="text-xs text-muted-foreground mt-2">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Meridian Takeoff</h1>
              <p className="text-muted-foreground mt-2">
                Professional construction takeoff software
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="lg" onClick={handleOpenExisting}>
                <Upload className="w-5 h-5 mr-2" />
                Open Existing
              </Button>
              <Button size="lg" onClick={handleNewProject}>
                <Plus className="w-5 h-5 mr-2" />
                New Project
              </Button>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-md">
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                Grid
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                List
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Projects Container */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="bg-white border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleProjectClick(project.id)}
              >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {project.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {project.client}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FolderOpen className="w-3 h-3" />
                    {project.location}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleProjectBackup(project, e)}
                    className="text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                    title="Backup project"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleEditProject(project, e)}
                    className="text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    title="Project settings"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    title="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">
                    {project.status || 'active'}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    ${getProjectTotalCost(project.id).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{project.takeoffCount || 0} takeoffs</span>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {project.lastModified ? new Date(project.lastModified).toLocaleDateString() : ''}
                  </div>
                </div>
              </div>
            </div>
          ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="bg-white border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleProjectClick(project.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                          {project.name}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          {project.client}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FolderOpen className="w-3 h-3" />
                          {project.location}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="outline">
                          {project.status || 'active'}
                        </Badge>
                        <span className="text-sm font-medium text-foreground">
                          ${getProjectTotalCost(project.id).toLocaleString()}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {project.takeoffCount || 0} takeoffs
                        </span>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {project.lastModified ? new Date(project.lastModified).toLocaleDateString() : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleProjectBackup(project, e)}
                      className="text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                      title="Backup project"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleEditProject(project, e)}
                      className="text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                      title="Project settings"
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleDeleteProject(project.id, e)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredProjects.length === 0 && (
          <div className="text-center py-12">
            <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              No projects found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery ? 'Try adjusting your search terms.' : 'Get started by creating your first project.'}
            </p>
            {!searchQuery && (
              <Button onClick={handleNewProject}>
                <Plus className="w-4 h-4 mr-2" />
                Create Project
              </Button>
            )}
          </div>
        )}
      </div>

        <ProjectCreationDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={async (proj) => {
          // The project is already added to the store by addProject
          // Just close the dialog
          setShowCreate(false);
        }}
      />

      {editingProject && (
        <ProjectSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          project={editingProject}
          onUpdated={async () => {
            // The project is already updated in the store by updateProject
            // Just close the dialog and clear the editing project
            setShowSettings(false);
            setEditingProject(null);
          }}
        />
      )}

      <BackupDialog
        open={showBackup}
        onOpenChange={setShowBackup}
        mode={backupMode}
        projectId={selectedProjectForBackup?.id}
        projectName={selectedProjectForBackup?.name}
      />
    </div>
  );
}

