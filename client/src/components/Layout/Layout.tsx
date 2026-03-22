import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

function Layout({ children }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <h1 className={styles.logoText}>Pyramid</h1>
        </div>
        <nav className={styles.nav}>
          <NavLink to="/" end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Dashboard
          </NavLink>
          <NavLink to="/sessions" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Sessions
          </NavLink>
          <NavLink to="/sessions/new" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            New Session
          </NavLink>
          <NavLink to="/cp" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            CP Practice
          </NavLink>
          <NavLink to="/repos" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            Repos
          </NavLink>
        </nav>
        <div className={styles.sidebarFooter}>
          <ThemeToggle />
        </div>
      </aside>
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}

export default Layout;
