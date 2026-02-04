import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { 
  Plus, 
  FolderOpen, 
  Calendar,
  Upload,
  Trash2,
  Settings,
  Download,
  User
} from 'lucide-react';
import { toast } from 'sonner';
import { projectService } from '../services/apiService';
import { supabase } from '../lib/supabase';
import { ProjectCreationDialog } from './ProjectCreationDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { BackupDialog } from './BackupDialog';
import { AdminPanel } from './AdminPanel';
import UserProfile from './UserProfile';
import { useProjectStore } from '../store/slices/projectSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { authHelpers } from '../lib/supabase';
import type { Project } from '../types';

export function ProjectList() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [backupMode, setBackupMode] = useState<'backup' | 'restore'>('restore');
  const [selectedProjectForBackup, setSelectedProjectForBackup] = useState<Project | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [isAdmin, _setIsAdmin] = useState(false);
  const [conditionCounts, setConditionCounts] = useState<Record<string, number>>({});
  
  const projects = useProjectStore((s) => s.projects);
  const loadInitialData = useProjectStore((s) => s.loadInitialData);
  const getProjectTotalCost = useMeasurementStore((s) => s.getProjectTotalCost);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Wait for authentication to complete before loading projects
        const user = await authHelpers.getCurrentUser();
        if (!user) {
          setError('User not authenticated');
          return;
        }
        
        await loadInitialData();
        if (!mounted) return;
      } catch (e: unknown) {
        if (!mounted) return;
        console.error('Error loading projects:', e);
        setError(e instanceof Error ? e.message : 'Could not load projects');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [loadInitialData]);

  // Fetch per-project condition counts so cards can show "X conditions"
  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      if (!projects || projects.length === 0) return;
      console.log('Fetching condition counts for projects:', projects.map(p => ({ id: p.id, name: p.name })));
      
      // Process all projects in parallel for better performance
      const countPromises = projects.map(async (project) => {
        try {
          console.log(`Querying conditions for project ${project.id} (${project.name})`);
          const { count, error } = await supabase
            .from('takeoff_conditions')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', project.id);
          if (error) {
            console.error(`Error querying conditions for project ${project.id}:`, error);
            return [project.id, 0];
          }
          console.log(`Project ${project.id} has ${count || 0} conditions`);
          return [project.id, count || 0];
        } catch (e) {
          console.error(`Failed to get condition count for project ${project.id}:`, e);
          return [project.id, 0];
        }
      });
      
      const results = await Promise.all(countPromises);
      if (!cancelled) {
        const newCounts = Object.fromEntries(results);
        console.log('Setting condition counts:', newCounts);
        setConditionCounts(newCounts);
      }
    }
    fetchCounts();
    return () => { cancelled = true; };
  }, [projects]);

  const filteredProjects = (projects || []).filter(project =>
    (project.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.client || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (project.location || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Debug: Log the projects being rendered
  console.log('Projects being rendered:', filteredProjects.map(p => ({ id: p.id, name: p.name })));
  console.log('Current conditionCounts state:', conditionCounts);
  console.log('RENDER DEBUG - conditionCounts for project:', filteredProjects.map(p => ({ id: p.id, count: conditionCounts[p.id] })));

  const handleProjectClick = (projectId: string) => {
    navigate(`/project/${projectId}`);
  };

  const handleNewProject = () => setShowCreate(true);

  const handleOpenExisting = () => {
    setBackupMode('restore');
    setShowBackup(true);
  };

  const handleProjectBackup = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the project
    setBackupMode('backup');
    setSelectedProjectForBackup(project);
    setShowBackup(true);
  };

  const handleEditProject = (project: Project, e: React.MouseEvent) => {
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
        toast.error('Failed to delete project. Please try again.');
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
              <Button variant="outline" size="lg" onClick={() => setShowUserProfile(true)}>
                <User className="w-5 h-5 mr-2" />
                Profile
              </Button>
              {isAdmin && (
                <Button variant="outline" size="lg" onClick={() => setShowAdminPanel(true)}>
                  <Settings className="w-5 h-5 mr-2" />
                  Admin
                </Button>
              )}
              <Button variant="outline" size="lg" onClick={handleOpenExisting}>
                <Upload className="w-5 h-5 mr-2" />
                Open Existing
              </Button>
              <Button size="lg" onClick={handleNewProject}>
                <Plus className="w-5 h-5 mr-2" />
                New Project
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                onClick={() => setShowAdminPanel(true)}
                className="text-purple-600 border-purple-200 hover:bg-purple-50"
              >
                <Settings className="w-5 h-5 mr-2" />
                Admin Panel
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
                <div className="flex items-center justify-end">
                  <span className="text-sm font-medium text-foreground">
                    ${getProjectTotalCost(project.id).toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{conditionCounts[project.id] || 0} conditions</span>
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
                key={`${project.id}-${conditionCounts[project.id] || 0}`}
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
                        <span className="text-sm font-medium text-foreground">
                          ${getProjectTotalCost(project.id).toLocaleString()}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {conditionCounts[project.id] ? `${conditionCounts[project.id]} conditions` : '0 takeoffs'}
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
        onCreated={async (_proj) => {
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

      <AdminPanel
        isOpen={showAdminPanel}
        onClose={() => setShowAdminPanel(false)}
        projectId="global" // Global admin panel, not project-specific
      />

      {showUserProfile && (
        <UserProfile
          onClose={() => setShowUserProfile(false)}
        />
      )}
    </div>
  );
}

