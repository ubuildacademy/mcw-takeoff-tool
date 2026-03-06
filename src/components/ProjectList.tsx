import { useEffect, useMemo, useState } from 'react';
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
  Share2,
  User,
  Users,
  ChevronDown,
  ChevronRight,
  Search
} from 'lucide-react';
import { toast } from 'sonner';
import { projectService } from '../services/apiService';
import { ProjectCreationDialog } from './ProjectCreationDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { BackupDialog } from './BackupDialog';
import { ShareProjectModal } from './ShareProjectModal';
import { AdminPanel } from './AdminPanel';
import UserProfile from './UserProfile';
import { useProjectStore } from '../store/slices/projectSlice';
import { useMeasurementStore } from '../store/slices/measurementSlice';
import { authHelpers } from '../lib/supabase';
import type { UserMetadata } from '../lib/supabase';
import type { Project } from '../types';

/** Group projects by owner (for admin view). Returns [{ userId, userName, projects }].
 * Includes ALL users (even with no projects). Current user first, rest alphabetically. */
function groupProjectsByUser(
  projects: Project[],
  users: UserMetadata[],
  currentUserId: string | null
): Array<{ userId: string; userName: string; projects: Project[] }> {
  const projectMap = new Map<string, Project[]>();
  for (const p of projects) {
    const uid = p.userId ?? '__unknown__';
    const list = projectMap.get(uid);
    if (list) {
      list.push(p);
    } else {
      projectMap.set(uid, [p]);
    }
  }
  const result: Array<{ userId: string; userName: string; projects: Project[] }> = [];
  for (const u of users) {
    result.push({
      userId: u.id,
      userName: u.full_name || u.company || 'Unknown User',
      projects: projectMap.get(u.id) ?? [],
    });
  }
  const unknownProjs = projectMap.get('__unknown__');
  if (unknownProjs && unknownProjs.length > 0) {
    result.push({ userId: '__unknown__', userName: 'Unknown Owner', projects: unknownProjs });
  }
  result.sort((a, b) => {
    if (currentUserId && a.userId === currentUserId) return -1;
    if (currentUserId && b.userId === currentUserId) return 1;
    return a.userName.localeCompare(b.userName, undefined, { sensitivity: 'base' });
  });
  return result;
}

const CARD_BASE = 'bg-white border rounded-lg p-6 cursor-pointer hover:shadow-md transition-shadow';
const ACTION_BUTTON = 'text-gray-500 hover:text-gray-700 hover:bg-gray-50';

interface ProjectCardsSectionProps {
  projects: Project[];
  variant: 'grid' | 'list';
  getProjectTotalCost: (id: string) => number;
  onShare: (p: Project, e: React.MouseEvent) => void;
  onBackup: (p: Project, e: React.MouseEvent) => void;
  onEdit: (p: Project, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onClick: (id: string) => void;
}

function ProjectCardsSection({
  projects,
  variant,
  getProjectTotalCost,
  onShare,
  onBackup,
  onEdit,
  onDelete,
  onClick,
}: ProjectCardsSectionProps) {
  const cardProps = {
    getTotalCost: getProjectTotalCost,
    onShare,
    onBackup,
    onEdit,
    onDelete,
    onClick,
  };
  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} variant="grid" {...cardProps} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} variant="list" {...cardProps} />
      ))}
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  getTotalCost: (id: string) => number;
  onShare: (p: Project, e: React.MouseEvent) => void;
  onBackup: (p: Project, e: React.MouseEvent) => void;
  onEdit: (p: Project, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onClick: (id: string) => void;
  variant: 'grid' | 'list';
}

function ProjectCard({ project, getTotalCost, onShare, onBackup, onEdit, onDelete, onClick, variant }: ProjectCardProps) {
  const totalCost = project.totalValue ?? getTotalCost(project.id);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const actions = (
    <div className={`flex items-center gap-1 shrink-0 ${variant === 'list' ? 'ml-4' : ''}`}>
      <Button variant="ghost" size="sm" onClick={(e) => { stop(e); onShare(project, e); }} className="text-green-600 hover:text-green-700 hover:bg-green-50" title="Share project via email">
        <Share2 className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={(e) => { stop(e); onBackup(project, e); }} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50" title="Backup project">
        <Download className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={(e) => { stop(e); onEdit(project, e); }} className={ACTION_BUTTON} title="Project settings">
        <Settings className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={(e) => { stop(e); onDelete(project.id, e); }} className="text-red-500 hover:text-red-700 hover:bg-red-50" title="Delete project">
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );

  if (variant === 'grid') {
    return (
      <div className={CARD_BASE} onClick={() => onClick(project.id)}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-1">{project.name}</h3>
            <p className="text-sm text-muted-foreground mb-2">{project.client}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FolderOpen className="w-3 h-3" />
              {project.location}
            </div>
          </div>
          {actions}
        </div>
        <div className="space-y-3">
          <div className="flex justify-end">
            <span className="text-sm font-medium text-foreground">${totalCost.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{project.conditionCount ?? 0} conditions</span>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {project.lastModified ? new Date(project.lastModified).toLocaleDateString() : ''}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={CARD_BASE} onClick={() => onClick(project.id)}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground mb-1">{project.name}</h3>
              <p className="text-sm text-muted-foreground mb-2">{project.client}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FolderOpen className="w-3 h-3" />
                {project.location}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">${totalCost.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">
                {project.conditionCount ? `${project.conditionCount} conditions` : `${project.takeoffCount ?? 0} takeoffs`}
              </span>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="w-3 h-3" />
                {project.lastModified ? new Date(project.lastModified).toLocaleDateString() : ''}
              </div>
            </div>
          </div>
        </div>
        {actions}
      </div>
    </div>
  );
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
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [backupMode, setBackupMode] = useState<'backup' | 'restore'>('restore');
  const [selectedProjectForBackup, setSelectedProjectForBackup] = useState<Project | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedProjectForShare, setSelectedProjectForShare] = useState<Project | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [collapsedUserIds, setCollapsedUserIds] = useState<Set<string>>(new Set());
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const toggleUserSection = (userId: string) =>
    setCollapsedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });

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
        if (mounted) setCurrentUserId(user.id);

        const [adminStatus] = await Promise.all([
          authHelpers.isAdmin(user.id),
          loadInitialData()
        ]);
        if (mounted) {
          setIsAdmin(adminStatus);
          if (adminStatus) {
            const userList = await authHelpers.getAllUsers();
            if (mounted) setUsers(userList ?? []);
          } else {
            setUsers([]);
          }
        }
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

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return (projects || []).filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.client || '').toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const groupedByUser = useMemo(
    () => (isAdmin ? groupProjectsByUser(filteredProjects, users, currentUserId) : null),
    [isAdmin, filteredProjects, users, currentUserId]
  );

  const filteredGroupedByUser = useMemo(() => {
    if (!groupedByUser) return null;
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return groupedByUser;
    return groupedByUser.filter(
      (g) =>
        (g.userName || '').toLowerCase().includes(q) ||
        (g.userId !== '__unknown__' && g.userId.toLowerCase().includes(q))
    );
  }, [groupedByUser, userSearchQuery]);

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

  const handleProjectShare = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the project
    setSelectedProjectForShare(project);
    setShowShareModal(true);
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
      <header className="border-b bg-logoBg">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <img
                src="/logo.png"
                alt="Meridian Takeoff"
                className="h-12 w-12 object-contain"
                width={48}
                height={48}
              />
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Meridian Takeoff</h1>
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
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-4">
            <div className="flex-1 max-w-md">
              <Input
                id="search-projects"
                name="search-projects"
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
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {groupedByUser && groupedByUser.length > 0 ? (
          <div className="space-y-10">
            {/* Admin: user search + collapse/expand all */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="search-users"
                  name="search-users"
                  placeholder="Search users..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => groupedByUser && setCollapsedUserIds(new Set(groupedByUser.map((g) => g.userId)))}>
                  Collapse all
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCollapsedUserIds(new Set())}>
                  Expand all
                </Button>
              </div>
            </div>
            {filteredGroupedByUser && filteredGroupedByUser.length > 0 ? (
              filteredGroupedByUser.map((group) => {
                const isCollapsed = collapsedUserIds.has(group.userId);
                return (
                  <div key={group.userId}>
                    <button
                      type="button"
                      onClick={() => toggleUserSection(group.userId)}
                      className="flex items-center gap-2 mb-4 w-full text-left hover:opacity-80 transition-opacity"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                      )}
                      <Users className="w-5 h-5 text-muted-foreground" />
                      <h2 className="text-lg font-semibold text-foreground">{group.userName}</h2>
                      <span className="text-sm text-muted-foreground">
                        ({group.projects.length} project{group.projects.length !== 1 ? 's' : ''})
                      </span>
                    </button>
                    {!isCollapsed && (
                      <ProjectCardsSection
                        projects={group.projects}
                        variant={viewMode}
                        getProjectTotalCost={getProjectTotalCost}
                        onShare={handleProjectShare}
                        onBackup={handleProjectBackup}
                        onEdit={handleEditProject}
                        onDelete={handleDeleteProject}
                        onClick={handleProjectClick}
                      />
                    )}
                  </div>
                );
              })
            ) : (
              <p className="text-muted-foreground py-4">No users match your search.</p>
            )}
          </div>
        ) : (
          <ProjectCardsSection
            projects={filteredProjects}
            variant={viewMode}
            getProjectTotalCost={getProjectTotalCost}
            onShare={handleProjectShare}
            onBackup={handleProjectBackup}
            onEdit={handleEditProject}
            onDelete={handleDeleteProject}
            onClick={handleProjectClick}
          />
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
      </main>

      <ProjectCreationDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => setShowCreate(false)}
      />

      {editingProject && (
        <ProjectSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          project={editingProject}
          onUpdated={() => {
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

      {selectedProjectForShare && (
        <ShareProjectModal
          projectId={selectedProjectForShare.id}
          projectName={selectedProjectForShare.name || 'Project'}
          isOpen={showShareModal}
          onClose={() => {
            setShowShareModal(false);
            setSelectedProjectForShare(null);
          }}
        />
      )}

      {isAdmin && (
        <AdminPanel
          isOpen={showAdminPanel}
          onClose={() => setShowAdminPanel(false)}
          projectId="global" // Global admin panel, not project-specific
        />
      )}

      {showUserProfile && (
        <UserProfile
          onClose={() => setShowUserProfile(false)}
        />
      )}
    </div>
  );
}

