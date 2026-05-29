import { ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import SettingsModal from '../SettingsModal/SettingsModal';
import { useFullscreen } from '../../contexts/FullscreenContext';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import {
  ChevronLeftIcon,
  GridIcon,
  InfoIcon,
  ListIcon,
  MinimizeIcon,
  SettingsIcon,
} from '../Icons/Icons';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

const COLLAPSED_KEY = 'pyramid_sidebar_collapsed';

function Layout({ children }: LayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  });
  const { fullscreen, toggle: toggleFullscreen, setFullscreen } = useFullscreen();

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useKeyboardShortcut('toggleFullscreen', toggleFullscreen);
  useKeyboardShortcut('toggleSidebar', useCallback(() => setCollapsed(c => !c), []));

  // Escape always restores chrome, so fullscreen is never a trap.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, setFullscreen]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `${styles.navLink} ${isActive ? styles.active : ''}`;

  return (
    <div
      className={`${styles.layout} ${collapsed ? styles.layoutCollapsed : ''} ${
        fullscreen ? styles.layoutFullscreen : ''
      }`}
    >
      {!fullscreen && (
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          {!collapsed && <h1 className={styles.logoText}>Pyramid</h1>}
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeftIcon size={16} className={collapsed ? styles.chevronFlipped : ''} />
          </button>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/" end className={navLinkClass} title="Dashboard">
            <GridIcon size={18} />
            <span className={styles.navLabel}>Dashboard</span>
          </NavLink>
          <NavLink to="/sessions" className={navLinkClass} title="Sessions">
            <ListIcon size={18} />
            <span className={styles.navLabel}>Sessions</span>
          </NavLink>
          <NavLink to="/info" className={navLinkClass} title="Info">
            <InfoIcon size={18} />
            <span className={styles.navLabel}>Info</span>
          </NavLink>
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon size={18} />
            <span className={styles.navLabel}>Settings</span>
          </button>
        </div>
      </aside>
      )}
      <main className={styles.main}>
        {children}
      </main>
      {fullscreen && (
        <button
          className={styles.exitFullscreenBtn}
          onClick={() => setFullscreen(false)}
          title="Exit fullscreen (Esc)"
          aria-label="Exit fullscreen"
        >
          <MinimizeIcon size={16} />
        </button>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default Layout;
